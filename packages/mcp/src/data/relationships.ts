import { and, eq } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';
import { getObject } from './objects.js';

export interface RelationshipRow {
  id: string;
  userId: string;
  fromId: string;
  toId: string;
  kind: schema.ObjectRelationship['kind'];
  confidence: number;
  reason: string;
  source: string;
  createdAt: Date;
}

async function assertObjectOwned(
  userId: string,
  objectId: string,
): Promise<void> {
  const obj = await getObject(userId, objectId);
  if (!obj) throw new Error('object not found');
}

export async function linkObjects(
  userId: string,
  fromId: string,
  toId: string,
  kind: schema.ObjectRelationship['kind'],
  confidence: number,
  reason: string,
  source: string,
): Promise<RelationshipRow> {
  if (fromId === toId) throw new Error('cannot link an object to itself');
  if (confidence < 0 || confidence > 1) throw new Error('confidence must be in [0, 1]');
  await assertObjectOwned(userId, fromId);
  await assertObjectOwned(userId, toId);
  const db = getDb();
  // upsert by (from_id, to_id, kind)
  const existing = await db
    .select()
    .from(schema.objectRelationships)
    .where(
      and(
        eq(schema.objectRelationships.userId, userId),
        eq(schema.objectRelationships.fromId, fromId),
        eq(schema.objectRelationships.toId, toId),
        eq(schema.objectRelationships.kind, kind),
      ),
    )
    .limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(schema.objectRelationships)
      .set({ confidence, reason, source })
      .where(eq(schema.objectRelationships.id, existing[0].id))
      .returning();
    if (!row) throw new Error('update failed');
    return rowToRelationship(row);
  }
  const [row] = await db
    .insert(schema.objectRelationships)
    .values({ userId, fromId, toId, kind, confidence, reason, source })
    .returning();
  if (!row) throw new Error('insert failed');
  return rowToRelationship(row);
}

export async function unlinkObjects(
  userId: string,
  fromId: string,
  toId: string,
  kind: schema.ObjectRelationship['kind'],
): Promise<{ ok: true }> {
  const db = getDb();
  await db
    .delete(schema.objectRelationships)
    .where(
      and(
        eq(schema.objectRelationships.userId, userId),
        eq(schema.objectRelationships.fromId, fromId),
        eq(schema.objectRelationships.toId, toId),
        eq(schema.objectRelationships.kind, kind),
      ),
    );
  return { ok: true };
}

function rowToRelationship(row: schema.ObjectRelationship): RelationshipRow {
  return {
    id: row.id,
    userId: row.userId,
    fromId: row.fromId,
    toId: row.toId,
    kind: row.kind,
    confidence: row.confidence,
    reason: row.reason,
    source: row.source,
    createdAt: row.createdAt,
  };
}
