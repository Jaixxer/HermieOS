import { and, eq } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';
import { archiveObject } from './objects.js';

export type FeedbackKind = 'like' | 'save' | 'ignore' | 'archive' | 'suggest';

export interface FeedbackRow {
  id: string;
  userId: string;
  objectId: string;
  kind: FeedbackKind;
  payload: Record<string, unknown>;
  createdAt: Date;
}

function rowToFeedback(row: schema.Feedback): FeedbackRow {
  return {
    id: row.id,
    userId: row.userId,
    objectId: row.objectId,
    kind: row.kind,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export async function recordFeedback(
  userId: string,
  objectId: string,
  kind: FeedbackKind,
  payload: Record<string, unknown> = {},
): Promise<FeedbackRow> {
  const db = getDb();
  // upsert by (user_id, object_id, kind)
  const existing = await db
    .select()
    .from(schema.feedback)
    .where(
      and(
        eq(schema.feedback.userId, userId),
        eq(schema.feedback.objectId, objectId),
        eq(schema.feedback.kind, kind),
      ),
    )
    .limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(schema.feedback)
      .set({ payload, createdAt: new Date() })
      .where(eq(schema.feedback.id, existing[0].id))
      .returning();
    if (!row) throw new Error('update failed');
    return rowToFeedback(row);
  }
  const [row] = await db
    .insert(schema.feedback)
    .values({ userId, objectId, kind, payload })
    .returning();
  if (!row) throw new Error('insert failed');

  // Side effect: archive the object too.
  if (kind === 'archive') {
    try {
      await archiveObject(userId, { id: objectId, source: 'user-feedback' });
    } catch {
      // ignore: object may already be archived
    }
  }
  return rowToFeedback(row);
}
