import { and, desc, eq, inArray, isNull, sql, asc } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

export interface TaskRow {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  category: schema.Task['category'];
  status: schema.Task['status'];
  priority: number;
  dueAt: Date | null;
  completedAt: Date | null;
  createdBy: schema.Task['createdBy'];
  batchId: string | null;
  sentToHermesAt: Date | null;
  objectId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
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
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    createdBy: row.createdBy,
    batchId: row.batchId,
    sentToHermesAt: row.sentToHermesAt,
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
  dueAt?: Date;
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
      dueAt: input.dueAt,
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
  dueAt?: Date | null;
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
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
  const [row] = await db
    .update(schema.tasks)
    .set(patch)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
    .returning();
  return row ? rowToTask(row) : null;
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
  if (opts.since) conds.push(sql`${schema.tasks.createdAt} >= ${opts.since.toISOString()}`);
  if (opts.until) conds.push(sql`${schema.tasks.createdAt} <= ${opts.until.toISOString()}`);
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(...conds))
    .orderBy(desc(schema.tasks.priority), asc(schema.tasks.dueAt), desc(schema.tasks.createdAt))
    .limit(opts.limit + 1);
  const sliced = rows.slice(0, opts.limit);
  return { tasks: sliced.map(rowToTask), hasMore: rows.length > opts.limit };
}

export async function getTask(userId: string, id: string): Promise<TaskRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)));
  return row ? rowToTask(row) : null;
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
