import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

export interface HermesRunRow {
  id: string;
  userId: string;
  kind: schema.HermesRun['kind'];
  subscriptionId: string | null;
  prompt: string;
  hermesRunId: string | null;
  attempt: number;
  status: schema.HermesRun['status'];
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  createdAt: Date;
}

function rowToRun(row: schema.HermesRun): HermesRunRow {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    subscriptionId: row.subscriptionId,
    prompt: row.prompt,
    hermesRunId: row.hermesRunId,
    attempt: row.attempt,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    createdAt: row.createdAt,
  };
}

export async function getRecentRuns(
  userId: string,
  status?: schema.HermesRun['status'],
  limit = 50,
): Promise<{ runs: HermesRunRow[] }> {
  const db = getDb();
  const conds = [eq(schema.hermesRuns.userId, userId)];
  if (status) conds.push(eq(schema.hermesRuns.status, status));
  const rows = await db
    .select()
    .from(schema.hermesRuns)
    .where(and(...conds))
    .orderBy(desc(schema.hermesRuns.createdAt))
    .limit(limit);
  return { runs: rows.map(rowToRun) };
}

// Convenience for the scheduler (Phase 2). Used by tests too.
export async function recordRunStart(
  userId: string,
  input: {
    kind: schema.HermesRun['kind'];
    subscriptionId?: string;
    prompt: string;
    attempt?: number;
  },
): Promise<HermesRunRow> {
  const db = getDb();
  const [row] = await db
    .insert(schema.hermesRuns)
    .values({
      userId,
      kind: input.kind,
      subscriptionId: input.subscriptionId ?? null,
      prompt: input.prompt,
      attempt: input.attempt ?? 1,
      status: 'dispatched',
    })
    .returning();
  if (!row) throw new Error('insert failed');
  return rowToRun(row);
}

export async function updateRunState(
  userId: string,
  runId: string,
  patch: {
    hermesRunId?: string;
    status?: schema.HermesRun['status'];
    startedAt?: Date;
    finishedAt?: Date;
    error?: string;
  },
): Promise<HermesRunRow> {
  const db = getDb();
  const set: Partial<typeof schema.hermesRuns.$inferInsert> = {};
  if (patch.hermesRunId !== undefined) set.hermesRunId = patch.hermesRunId;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
  if (patch.finishedAt !== undefined) set.finishedAt = patch.finishedAt;
  if (patch.error !== undefined) set.error = patch.error;
  const [row] = await db
    .update(schema.hermesRuns)
    .set(set)
    .where(and(eq(schema.hermesRuns.id, runId), eq(schema.hermesRuns.userId, userId)))
    .returning();
  if (!row) throw new Error('run not found');
  return rowToRun(row);
}
