import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

/**
 * The task progress log — the shared channel between the user and Hermes.
 *
 * Every progress note on a task is one row. The user writes from the app
 * (actor='user'), Hermes writes through the `add_task_progress` MCP tool
 * (actor='hermes'). Nothing is private: on a delegated task the app relays
 * the user's entries into the task's Hermes conversation, and Hermes'
 * entries show up in the app's log.
 */

export type TaskUpdateActor = 'user' | 'hermes' | 'system';
export type TaskUpdateKind = 'progress' | 'blocker' | 'handoff' | 'note' | 'status';

export interface TaskUpdateRow {
  id: string;
  taskId: string;
  userId: string;
  actor: TaskUpdateActor;
  kind: TaskUpdateKind;
  body: string;
  percent: number | null;
  /** Set when this entry was relayed into the Hermes task conversation. */
  sharedWithHermesAt: Date | null;
  createdAt: Date;
}

function rowToUpdate(row: schema.TaskUpdate): TaskUpdateRow {
  return {
    id: row.id,
    taskId: row.taskId,
    userId: row.userId,
    actor: row.actor,
    kind: row.kind,
    body: row.body,
    percent: row.percent,
    sharedWithHermesAt: row.sharedWithHermesAt,
    createdAt: row.createdAt,
  };
}

export interface AddTaskUpdateInput {
  actor: TaskUpdateActor;
  kind?: TaskUpdateKind;
  body: string;
  /** Progress claim 0-100. Omitted = a pure note, progress_percent untouched. */
  percent?: number | null;
  /** Pre-set when the caller has already relayed this entry to Hermes. */
  sharedWithHermesAt?: Date | null;
}

export interface AddTaskUpdateResult {
  update: TaskUpdateRow;
  /** The task after the write (status may have flipped to in_progress). */
  progressPercent: number;
  status: schema.Task['status'];
}

/**
 * Append a progress entry and mirror the claim onto the task.
 *
 * Rules (deliberately narrow so nothing changes state behind the user's back):
 *   - a percent claim updates tasks.progress_percent
 *   - a claim between 1 and 99 moves a `todo` task to `in_progress`
 *   - hitting 100 does NOT auto-complete; completing stays the user's call
 */
export async function addTaskUpdate(
  userId: string,
  taskId: string,
  input: AddTaskUpdateInput,
): Promise<AddTaskUpdateResult | null> {
  const db = getDb();
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
  if (!task) return null;

  const percent = input.percent == null ? null : Math.max(0, Math.min(100, Math.round(input.percent)));

  const [row] = await db
    .insert(schema.taskUpdates)
    .values({
      taskId,
      userId,
      actor: input.actor,
      kind: input.kind ?? 'progress',
      body: input.body,
      percent,
      sharedWithHermesAt: input.sharedWithHermesAt ?? null,
    })
    .returning();

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  let status = task.status;
  if (percent != null) {
    patch.progressPercent = percent;
    if (percent > 0 && percent < 100 && task.status === 'todo') {
      patch.status = 'in_progress';
      status = 'in_progress';
    }
  }
  await db
    .update(schema.tasks)
    .set(patch)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));

  return {
    update: rowToUpdate(row!),
    progressPercent: percent != null ? percent : (task.progressPercent ?? 0),
    status,
  };
}

export async function listTaskUpdates(
  userId: string,
  taskId: string,
  opts: { limit?: number } = {},
): Promise<TaskUpdateRow[] | null> {
  const db = getDb();
  const [task] = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
  if (!task) return null;
  const rows = await db
    .select()
    .from(schema.taskUpdates)
    .where(and(eq(schema.taskUpdates.taskId, taskId), eq(schema.taskUpdates.userId, userId)))
    .orderBy(desc(schema.taskUpdates.createdAt))
    .limit(opts.limit ?? 50);
  return rows.map(rowToUpdate);
}

export async function markUpdateSharedWithHermes(userId: string, updateId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.taskUpdates)
    .set({ sharedWithHermesAt: new Date() })
    .where(and(eq(schema.taskUpdates.id, updateId), eq(schema.taskUpdates.userId, userId)));
}

export interface ProgressSummary {
  latest: TaskUpdateRow | null;
  count: number;
  /** Open blockers = entries of kind 'blocker' newer than the newest progress entry. */
  blockers: number;
}

/**
 * One query for the newest entry + total count per task. Used to decorate
 * task lists (the dashboard, the day board) without an N+1.
 *
 * `blockers` counts entries of kind 'blocker' raised since the last
 * non-blocker entry — i.e. blockers that are still open.
 */
export async function attachProgress(
  userId: string,
  taskIds: string[],
): Promise<Map<string, ProgressSummary>> {
  const map = new Map<string, ProgressSummary>();
  if (taskIds.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.taskUpdates)
    .where(and(eq(schema.taskUpdates.userId, userId), inArray(schema.taskUpdates.taskId, taskIds)))
    .orderBy(desc(schema.taskUpdates.createdAt));
  // Newest first: the first row per task is the latest entry, and any
  // blocker met before a non-blocker entry is still open.
  const settled = new Set<string>();
  for (const r of rows) {
    let summary = map.get(r.taskId);
    if (!summary) {
      summary = { latest: rowToUpdate(r), count: 0, blockers: 0 };
      map.set(r.taskId, summary);
    }
    summary.count += 1;
    if (r.kind === 'blocker') {
      if (!settled.has(r.taskId)) summary.blockers += 1;
    } else {
      settled.add(r.taskId);
    }
  }
  return map;
}

/** Latest entry per task, cheaply, for a single task id. */
export async function getLatestUpdate(userId: string, taskId: string): Promise<TaskUpdateRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.taskUpdates)
    .where(and(eq(schema.taskUpdates.taskId, taskId), eq(schema.taskUpdates.userId, userId)))
    .orderBy(desc(schema.taskUpdates.createdAt))
    .limit(1);
  return row ? rowToUpdate(row) : null;
}

/** Count of entries, for guard rails / analytics. */
export async function countTaskUpdates(userId: string, taskId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.taskUpdates)
    .where(and(eq(schema.taskUpdates.taskId, taskId), eq(schema.taskUpdates.userId, userId)));
  return Number(rows[0]?.n ?? 0);
}
