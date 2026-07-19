import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';
import { getObject } from './objects.js';

export interface ObjectEventRow {
  id: string;
  objectId: string;
  userId: string;
  kind: schema.ObjectEvent['kind'];
  actor: schema.ObjectEvent['actor'];
  payload: Record<string, unknown>;
  createdAt: Date;
}

function rowToObjectEvent(row: schema.ObjectEvent): ObjectEventRow {
  return {
    id: row.id,
    objectId: row.objectId,
    userId: row.userId,
    kind: row.kind,
    actor: row.actor,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export async function getObjectTimeline(
  userId: string,
  objectId: string,
  limit: number,
  cursor?: string,
): Promise<{ events: ObjectEventRow[]; nextCursor: string | null }> {
  // confirm ownership
  const owner = await getObject(userId, objectId);
  if (!owner) return { events: [], nextCursor: null };

  const db = getDb();
  const conds = [eq(schema.objectEvents.objectId, objectId)];
  if (cursor) {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = new Date(decoded);
    if (Number.isNaN(parsed.getTime())) throw new Error('invalid cursor');
    conds.push(sql`${schema.objectEvents.createdAt} < ${parsed.toISOString()}`);
  }
  const rows = await db
    .select()
    .from(schema.objectEvents)
    .where(and(...conds))
    .orderBy(desc(schema.objectEvents.createdAt))
    .limit(limit + 1);
  const sliced = rows.slice(0, limit);
  const last = sliced[sliced.length - 1];
  const nextCursor =
    rows.length > limit && last ? Buffer.from(last.createdAt.toISOString()).toString('base64url') : null;
  return { events: sliced.map(rowToObjectEvent), nextCursor };
}
