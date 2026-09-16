import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';
import { attachProgress, type TaskUpdateRow } from './task-updates.js';

export interface TaskRow {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  category: schema.Task['category'];
  status: schema.Task['status'];
  priority: number;
  /** Calendar day the user assigned this task to (YYYY-MM-DD), or null. */
  scheduledFor: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  createdBy: schema.Task['createdBy'];
  batchId: string | null;
  sentToHermesAt: Date | null;
  /** Standing brief for Hermes (the delegation note), if any. */
  delegateNote: string | null;
  delegatedAt: Date | null;
  progressPercent: number;
  objectId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  /** Newest progress entry (filled by attachProgress on list/get paths). */
  latestUpdate?: TaskUpdateRow | null;
  /** Total number of progress entries. */
  updatesCount?: number;
}

function rowToTask(row: schema.Task): TaskRow {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    notes: row.notes,
    category: row.category,
    status: row.status,
    priority: row.priority,
    scheduledFor: row.scheduledFor ?? null,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    createdBy: row.createdBy,
    batchId: row.batchId,
    sentToHermesAt: row.sentToHermesAt,
    delegateNote: row.delegateNote ?? null,
    delegatedAt: row.delegatedAt,
    progressPercent: row.progressPercent ?? 0,
    objectId: row.objectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

export interface CreateTaskInput {
  title: string;
  notes?: string;
  category?: schema.Task['category'];
  status?: schema.Task['status'];
  priority?: number;
  scheduledFor?: string | null;
  dueAt?: Date;
  delegateNote?: string;
  objectId?: string;
  batchId?: string;
  createdBy: 'user' | 'hermes' | 'system';
}

export async function createTask(userId: string, input: CreateTaskInput): Promise<TaskRow> {
  const db = getDb();
  const [row] = await db
    .insert(schema.tasks)
    .values({
      userId,
      title: input.title,
      notes: input.notes,
      category: input.category ?? 'other',
      status: input.status ?? 'todo',
      priority: input.priority ?? 0,
      scheduledFor: input.scheduledFor ?? null,
      dueAt: input.dueAt,
      delegateNote: input.delegateNote,
      objectId: input.objectId,
      batchId: input.batchId,
      createdBy: input.createdBy,
    })
    .returning();
  return rowToTask(row!);
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string;
  category?: schema.Task['category'];
  status?: schema.Task['status'];
  priority?: number;
  scheduledFor?: string | null;
  dueAt?: Date | null;
  delegateNote?: string | null;
}

export async function updateTask(userId: string, id: string, input: UpdateTaskInput): Promise<TaskRow | null> {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.category !== undefined) patch.category = input.category;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === 'done') patch.completedAt = new Date();
    if (input.status !== 'done') patch.completedAt = null;
  }
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.scheduledFor !== undefined) patch.scheduledFor = input.scheduledFor;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
  if (input.delegateNote !== undefined) patch.delegateNote = input.delegateNote;
  const [row] = await db
    .update(schema.tasks)
    .set(patch)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
    .returning();
  if (!row) return null;
  const [decorated] = await withProgress(userId, [rowToTask(row)]);
  return decorated ?? null;
}

export async function archiveTask(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(schema.tasks)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId), isNull(schema.tasks.archivedAt)))
    .returning({ id: schema.tasks.id });
  return result.length > 0;
}

export interface ListTasksOpts {
  status?: schema.Task['status'];
  category?: schema.Task['category'];
  /** Assigned-day filter (YYYY-MM-DD). */
  scheduledFor?: string;
  /** Deadline window (dueAt), inclusive-ish: dueFrom <= dueAt < dueTo. */
  dueFrom?: Date;
  dueTo?: Date;
  /** true = only delegated tasks, false = only non-delegated. */
  delegated?: boolean;
  since?: Date;
  until?: Date;
  batchId?: string;
  limit: number;
}

export async function listTasks(userId: string, opts: ListTasksOpts): Promise<{ tasks: TaskRow[]; hasMore: boolean }> {
  const db = getDb();
  const conds = [eq(schema.tasks.userId, userId), isNull(schema.tasks.archivedAt)];
  if (opts.status) conds.push(eq(schema.tasks.status, opts.status));
  if (opts.category) conds.push(eq(schema.tasks.category, opts.category));
  if (opts.batchId) conds.push(eq(schema.tasks.batchId, opts.batchId));
  if (opts.scheduledFor) conds.push(eq(schema.tasks.scheduledFor, opts.scheduledFor));
  if (opts.dueFrom) conds.push(gte(schema.tasks.dueAt, opts.dueFrom));
  if (opts.dueTo) conds.push(lt(schema.tasks.dueAt, opts.dueTo));
  if (opts.delegated !== undefined) {
    conds.push(
      opts.delegated
        ? sql`${schema.tasks.delegatedAt} is not null`
        : sql`${schema.tasks.delegatedAt} is null`,
    );
  }
  if (opts.since) conds.push(sql`${schema.tasks.createdAt} >= ${opts.since.toISOString()}`);
  if (opts.until) conds.push(sql`${schema.tasks.createdAt} <= ${opts.until.toISOString()}`);
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(...conds))
    .orderBy(desc(schema.tasks.priority), asc(schema.tasks.dueAt), desc(schema.tasks.createdAt))
    .limit(opts.limit + 1);
  const sliced = rows.slice(0, opts.limit);
  return { tasks: await withProgress(userId, sliced.map(rowToTask)), hasMore: rows.length > opts.limit };
}

/**
 * The board for one calendar day.
 *
 * A task belongs on a day's board when any of these hold:
 *   - it is assigned to that day (scheduledFor)
 *   - it is due that day (dueAt inside the local day)
 *   - it is already in progress (in_progress carries across days)
 * Done/cancelled tasks drop off; overdue ones are NOT included here
 * (they have their own bucket on the dashboard).
 *
 * `day` is a calendar day in the server's local timezone (YYYY-MM-DD).
 */
export async function listTasksForDay(
  userId: string,
  day: string,
  opts: { limit?: number } = {},
): Promise<{ tasks: TaskRow[]; hasMore: boolean }> {
  const db = getDb();
  const limit = opts.limit ?? 50;
  const startOfDay = dayStart(day);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNull(schema.tasks.archivedAt),
        ne(schema.tasks.status, 'done'),
        ne(schema.tasks.status, 'cancelled'),
        or(
          eq(schema.tasks.scheduledFor, day),
          eq(schema.tasks.status, 'in_progress'),
          and(gte(schema.tasks.dueAt, startOfDay), lt(schema.tasks.dueAt, endOfDay)),
        ),
      ),
    )
    .orderBy(desc(schema.tasks.priority), asc(schema.tasks.dueAt), desc(schema.tasks.createdAt))
    .limit(limit + 1);
  const sliced = rows.slice(0, limit);
  return { tasks: await withProgress(userId, sliced.map(rowToTask)), hasMore: rows.length > limit };
}

/** Open (not done/cancelled) tasks whose deadline has passed. */
export async function listOverdueTasks(userId: string, limit = 20): Promise<TaskRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNull(schema.tasks.archivedAt),
        sql`${schema.tasks.status} <> 'done'`,
        sql`${schema.tasks.status} <> 'cancelled'`,
        lt(schema.tasks.dueAt, new Date()),
      ),
    )
    .orderBy(asc(schema.tasks.dueAt))
    .limit(limit);
  return withProgress(userId, rows.map(rowToTask));
}

export async function getTask(userId: string, id: string): Promise<TaskRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)));
  if (!row) return null;
  const [decorated] = await withProgress(userId, [rowToTask(row)]);
  return decorated ?? null;
}

/** Tasks assigned to one of the given days (used by the week view). */
export async function listTasksInDayRange(
  userId: string,
  days: string[],
  opts: { limit?: number } = {},
): Promise<TaskRow[]> {
  if (days.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNull(schema.tasks.archivedAt),
        inArray(schema.tasks.scheduledFor, days),
      ),
    )
    .orderBy(asc(schema.tasks.dueAt));
  const sliced = rows.slice(0, opts.limit ?? 200);
  return withProgress(userId, sliced.map(rowToTask));
}

export async function markTasksSentToHermes(userId: string, taskIds: string[]): Promise<number> {
  if (taskIds.length === 0) return 0;
  const db = getDb();
  const result = await db
    .update(schema.tasks)
    .set({ sentToHermesAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.tasks.userId, userId), inArray(schema.tasks.id, taskIds), isNull(schema.tasks.archivedAt)))
    .returning({ id: schema.tasks.id });
  return result.length;
}

/** Stamp the delegation moment (and keep the legacy batch-sent stamp in sync). */
export async function markTaskDelegated(userId: string, id: string, when = new Date()): Promise<TaskRow | null> {
  const db = getDb();
  const [row] = await db
    .update(schema.tasks)
    .set({ delegatedAt: when, sentToHermesAt: when, updatedAt: when })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
    .returning();
  return row ? rowToTask(row) : null;
}

// --- day helpers (server-local calendar days, matching the rest of the API) ---

/** YYYY-MM-DD for a Date in server-local time. */
export function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local midnight at the start of a YYYY-MM-DD day. */
export function dayStart(day: string): Date {
  const [y, m, d] = day.split('-').map((n) => parseInt(n, 10));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Attach the latest progress entry + count to a batch of tasks (one query). */
async function withProgress(userId: string, tasks: TaskRow[]): Promise<TaskRow[]> {
  if (tasks.length === 0) return tasks;
  const summaries = await attachProgress(userId, tasks.map((t) => t.id));
  for (const t of tasks) {
    const s = summaries.get(t.id);
    if (!s) continue;
    t.latestUpdate = s.latest;
    t.updatesCount = s.count;
    if (s.latest?.percent != null) t.progressPercent = s.latest.percent;
  }
  return tasks;
}
