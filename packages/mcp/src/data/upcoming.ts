import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

export interface UpcomingRow {
  id: string;
  userId: string;
  title: string;
  subtitle: string | null;
  kind: schema.Upcoming['kind'];
  occursAt: Date;
  location: string | null;
  notes: string | null;
  createdBy: schema.Upcoming['createdBy'];
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

function rowToUpcoming(row: schema.Upcoming): UpcomingRow {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    subtitle: row.subtitle,
    kind: row.kind,
    occursAt: row.occursAt,
    location: row.location,
    notes: row.notes,
    createdBy: row.createdBy,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

export interface CreateUpcomingInput {
  title: string;
  subtitle?: string;
  kind?: schema.Upcoming['kind'];
  occursAt: Date;
  location?: string;
  notes?: string;
  createdBy: 'user' | 'hermes' | 'system';
}

export async function createUpcoming(userId: string, input: CreateUpcomingInput): Promise<UpcomingRow> {
  const db = getDb();
  const [row] = await db
    .insert(schema.upcoming)
    .values({
      userId,
      title: input.title,
      subtitle: input.subtitle,
      kind: input.kind ?? 'event',
      occursAt: input.occursAt,
      location: input.location,
      notes: input.notes,
      createdBy: input.createdBy,
    })
    .returning();
  return rowToUpcoming(row!);
}

export interface UpdateUpcomingInput {
  title?: string;
  subtitle?: string;
  kind?: schema.Upcoming['kind'];
  occursAt?: Date;
  location?: string;
  notes?: string;
}

export async function updateUpcoming(userId: string, id: string, input: UpdateUpcomingInput): Promise<UpcomingRow | null> {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.subtitle !== undefined) patch.subtitle = input.subtitle;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.occursAt !== undefined) patch.occursAt = input.occursAt;
  if (input.location !== undefined) patch.location = input.location;
  if (input.notes !== undefined) patch.notes = input.notes;
  const [row] = await db
    .update(schema.upcoming)
    .set(patch)
    .where(and(eq(schema.upcoming.id, id), eq(schema.upcoming.userId, userId)))
    .returning();
  return row ? rowToUpcoming(row) : null;
}

export async function archiveUpcoming(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(schema.upcoming)
    .set({ archivedAt: new Date(), completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.upcoming.id, id), eq(schema.upcoming.userId, userId), isNull(schema.upcoming.archivedAt)))
    .returning({ id: schema.upcoming.id });
  return result.length > 0;
}

export interface ListUpcomingOpts {
  since?: Date;
  until?: Date;
  kind?: schema.Upcoming['kind'];
  limit: number;
}

export async function listUpcoming(userId: string, opts: ListUpcomingOpts): Promise<{ items: UpcomingRow[]; hasMore: boolean }> {
  const db = getDb();
  const conds = [eq(schema.upcoming.userId, userId), isNull(schema.upcoming.archivedAt)];
  if (opts.kind) conds.push(eq(schema.upcoming.kind, opts.kind));
  if (opts.since) conds.push(gte(schema.upcoming.occursAt, opts.since));
  if (opts.until) conds.push(lte(schema.upcoming.occursAt, opts.until));
  const rows = await db
    .select()
    .from(schema.upcoming)
    .where(and(...conds))
    .orderBy(asc(schema.upcoming.occursAt))
    .limit(opts.limit + 1);
  const sliced = rows.slice(0, opts.limit);
  return { items: sliced.map(rowToUpcoming), hasMore: rows.length > opts.limit };
}

export async function getUpcoming(userId: string, id: string): Promise<UpcomingRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.upcoming)
    .where(and(eq(schema.upcoming.id, id), eq(schema.upcoming.userId, userId)));
  return row ? rowToUpcoming(row) : null;
}
