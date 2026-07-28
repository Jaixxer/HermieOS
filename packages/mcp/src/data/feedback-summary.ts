import { and, eq, gte, desc } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

export type FeedbackKind = 'like' | 'save' | 'ignore' | 'archive' | 'suggest';

export interface RecentFeedbackRow {
  id: string;
  kind: FeedbackKind;
  payload: Record<string, unknown>;
  createdAt: Date;
  object: {
    id: string;
    type: string;
    title: string;
    summary: string | null;
  };
}

export interface FeedbackStats {
  total: number;
  byKind: Record<FeedbackKind, number>;
  likedOrSavedByType: Record<string, number>;
  suggestNotes: Array<{
    objectId: string;
    objectTitle: string;
    note: string;
  }>;
}

const EMPTY_BY_KIND: Record<FeedbackKind, number> = {
  like: 0,
  save: 0,
  ignore: 0,
  archive: 0,
  suggest: 0,
};

/**
 * Fetch the user's recent feedback rows (with their parent object)
 * since `since`. Used by the scheduler's dispatch envelope (so Hermes
 * can see what the user has been liking/saving/ignoring) and by the
 * web UI's Feedback tab on the Scouting page.
 */
export async function findRecentFeedback(
  userId: string,
  since: Date,
  limit = 50,
): Promise<RecentFeedbackRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.feedback.id,
      kind: schema.feedback.kind,
      payload: schema.feedback.payload,
      createdAt: schema.feedback.createdAt,
      objId: schema.objects.id,
      objType: schema.objects.type,
      objTitle: schema.objects.title,
      objSummary: schema.objects.summary,
    })
    .from(schema.feedback)
    .innerJoin(schema.objects, eq(schema.objects.id, schema.feedback.objectId))
    .where(
      and(
        eq(schema.feedback.userId, userId),
        gte(schema.feedback.createdAt, since),
      ),
    )
    .orderBy(desc(schema.feedback.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as FeedbackKind,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    object: {
      id: row.objId,
      type: row.objType,
      title: row.objTitle,
      summary: row.objSummary,
    },
  }));
}

/**
 * Aggregate a list of feedback rows into the stats summary that
 * mirrors what the scheduler's feedback-review envelope ships to Hermes.
 * Useful for the web UI's "Feedback" tab.
 */
export function aggregateFeedbackStats(rows: RecentFeedbackRow[]): FeedbackStats {
  const byKind: Record<FeedbackKind, number> = { ...EMPTY_BY_KIND };
  const likedOrSavedByType: Record<string, number> = {};
  const suggestNotes: FeedbackStats['suggestNotes'] = [];
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    if (r.kind === 'like' || r.kind === 'save') {
      const t = r.object.type;
      likedOrSavedByType[t] = (likedOrSavedByType[t] ?? 0) + 1;
    }
    if (r.kind === 'suggest') {
      const note = typeof r.payload['note'] === 'string' ? r.payload['note'] : '';
      if (note.trim().length > 0) {
        suggestNotes.push({
          objectId: r.object.id,
          objectTitle: r.object.title,
          note: note.trim(),
        });
      }
    }
  }
  return {
    total: rows.length,
    byKind,
    likedOrSavedByType,
    suggestNotes,
  };
}
