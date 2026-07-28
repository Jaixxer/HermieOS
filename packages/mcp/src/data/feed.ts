import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

export interface FeedEventRow {
  id: string;
  userId: string;
  kind: schema.FeedEvent['kind'];
  objectId: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

function rowToFeedEvent(row: schema.FeedEvent): FeedEventRow {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    objectId: row.objectId,
    title: row.title,
    body: row.body,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export async function getRecentActivity(
  userId: string,
  opts: { since?: Date; limit: number; kinds?: string[] },
): Promise<{ events: FeedEventRow[]; hasMore: boolean }> {
  const db = getDb();
  const conds = [eq(schema.feedEvents.userId, userId)];
  if (opts.since) {
    conds.push(sql`${schema.feedEvents.createdAt} > ${opts.since.toISOString()}`);
  }
  if (opts.kinds && opts.kinds.length > 0) {
    conds.push(inArray(schema.feedEvents.kind, opts.kinds as schema.FeedEvent['kind'][]));
  }
  const rows = await db
    .select()
    .from(schema.feedEvents)
    .where(and(...conds))
    .orderBy(desc(schema.feedEvents.createdAt))
    .limit(opts.limit + 1);
  const sliced = rows.slice(0, opts.limit);
  return { events: sliced.map(rowToFeedEvent), hasMore: rows.length > opts.limit };
}

export async function markFeedRead(userId: string, upTo: Date): Promise<{ updated: number }> {
  const db = getDb();
  const result = await db
    .update(schema.feedEvents)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.feedEvents.userId, userId),
        isNull(schema.feedEvents.readAt),
        sql`${schema.feedEvents.createdAt} <= ${upTo.toISOString()}`,
      ),
    )
    .returning({ id: schema.feedEvents.id });
  return { updated: result.length };
}

export interface RecordFeedEventInput {
  kind: schema.FeedEvent['kind'];
  objectId?: string | null;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Inserts a feed event for the given user. Used by tools (e.g. create_task,
 * create_opportunity) to surface user-visible activity in the dashboard.
 */
export async function recordFeedEvent(
  userId: string,
  input: RecordFeedEventInput,
): Promise<FeedEventRow> {
  const db = getDb();
  const [row] = await db
    .insert(schema.feedEvents)
    .values({
      userId,
      kind: input.kind,
      objectId: input.objectId ?? null,
      title: input.title,
      body: input.body ?? null,
      payload: input.payload ?? {},
    })
    .returning();
  return rowToFeedEvent(row!);
}
