import { and, avg, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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

/**
 * Create a run row in `dispatched` state. The run tracker (scheduler
 * process) settles it after the gateway reports a terminal state.
 * Used by the API for immediate, user-triggered runs (finding
 * follow-ups); the scheduler has its own local helper with the same
 * shape.
 */
export async function createRun(input: {
  userId: string;
  kind: schema.HermesRun['kind'];
  subscriptionId?: string;
  prompt: string;
  attempt?: number;
}): Promise<{ id: string }> {
  const db = getDb();
  const id = randomUUID();
  await db.insert(schema.hermesRuns).values({
    id,
    userId: input.userId,
    kind: input.kind,
    subscriptionId: input.subscriptionId ?? null,
    prompt: input.prompt,
    attempt: input.attempt ?? 1,
    status: 'dispatched',
  });
  return { id };
}

export async function markRunDispatched(
  runId: string,
  hermesRunId: string,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.hermesRuns)
    .set({ hermesRunId, status: 'running', startedAt: now })
    .where(eq(schema.hermesRuns.id, runId));
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

/**
 * Per-subscription (scout) run history. Newest first. Includes all
 * hermes_runs rows that reference the subscription, regardless of
 * status — so the user can see the full retry/success/fail trail.
 */
export async function getScoutRunHistory(
  userId: string,
  subscriptionId: string,
  limit = 50,
): Promise<{ runs: HermesRunRow[] }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.hermesRuns)
    .where(
      and(
        eq(schema.hermesRuns.userId, userId),
        eq(schema.hermesRuns.subscriptionId, subscriptionId),
      ),
    )
    .orderBy(desc(schema.hermesRuns.createdAt))
    .limit(limit);
  return { runs: rows.map(rowToRun) };
}

export interface ScoutMetrics {
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  /** Last 7 days. */
  last7DaysRuns: number;
  last7DaysSucceeded: number;
  /** Average runtime for successful runs in ms. null if no completed runs. */
  avgRuntimeMs: number | null;
  /** How many opportunity objects the scout's runs have created. */
  opportunitiesCreated: number;
  /** Top sources (by occurrences in objects.body->>'source') for the scout. */
  topSources: Array<{ source: string; count: number }>;
  /** Last successful run. null if never succeeded. */
  lastSuccessAt: Date | null;
  /** Last run, regardless of status. null if never run. */
  lastRunAt: Date | null;
}

/**
 * Aggregate metrics for a single scout. One round-trip with CTEs.
 *
 * - Runs counts come from hermes_runs filtered by subscription_id.
 * - Opportunities come from objects(type='opportunity') whose body
 *   references the scout via body->>'subscriptionId' OR body->>'source'
 *   matches the subscription's target. We use the body->>'subscriptionId'
 *   path (set by the agent when it records findings) and fall back to a
 *   body->>'target' match on the subscription's target string.
 */
export async function getScoutMetrics(
  userId: string,
  subscriptionId: string,
  subscriptionTarget: string,
): Promise<ScoutMetrics> {
  const db = getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);

  // Run counts (CTE)
  const countsRow = await db
    .select({
      total: count(),
      succeeded: sql<number>`count(*) filter (where ${schema.hermesRuns.status} = 'succeeded')`,
      failed: sql<number>`count(*) filter (where ${schema.hermesRuns.status} = 'failed')`,
      cancelled: sql<number>`count(*) filter (where ${schema.hermesRuns.status} = 'cancelled')`,
      last7: sql<number>`count(*) filter (where ${schema.hermesRuns.createdAt} >= ${sevenDaysAgo.toISOString()})`,
      last7Succeeded: sql<number>`count(*) filter (where ${schema.hermesRuns.status} = 'succeeded' and ${schema.hermesRuns.createdAt} >= ${sevenDaysAgo.toISOString()})`,
    })
    .from(schema.hermesRuns)
    .where(
      and(
        eq(schema.hermesRuns.userId, userId),
        eq(schema.hermesRuns.subscriptionId, subscriptionId),
      ),
    );

  // Average runtime for succeeded runs (ms)
  const avgRow = await db
    .select({
      avgMs: sql<number | null>`avg(extract(epoch from (${schema.hermesRuns.finishedAt} - ${schema.hermesRuns.startedAt})) * 1000)`,
    })
    .from(schema.hermesRuns)
    .where(
      and(
        eq(schema.hermesRuns.userId, userId),
        eq(schema.hermesRuns.subscriptionId, subscriptionId),
        eq(schema.hermesRuns.status, 'succeeded'),
        isNotNull(schema.hermesRuns.startedAt),
        isNotNull(schema.hermesRuns.finishedAt),
      ),
    );

  // Last run + last success
  const lastRunRow = await db
    .select({ at: schema.hermesRuns.createdAt })
    .from(schema.hermesRuns)
    .where(
      and(
        eq(schema.hermesRuns.userId, userId),
        eq(schema.hermesRuns.subscriptionId, subscriptionId),
      ),
    )
    .orderBy(desc(schema.hermesRuns.createdAt))
    .limit(1);
  const lastSuccessRow = await db
    .select({ at: schema.hermesRuns.createdAt })
    .from(schema.hermesRuns)
    .where(
      and(
        eq(schema.hermesRuns.userId, userId),
        eq(schema.hermesRuns.subscriptionId, subscriptionId),
        eq(schema.hermesRuns.status, 'succeeded'),
      ),
    )
    .orderBy(desc(schema.hermesRuns.createdAt))
    .limit(1);

  // Opportunities created with this scout's subscriptionId or target in body
  const oppsCountRow = await db
    .select({ count: count() })
    .from(schema.objects)
    .where(
      and(
        eq(schema.objects.userId, userId),
        eq(schema.objects.type, 'opportunity'),
        isNull(schema.objects.archivedAt),
        sql`(${schema.objects.body}->>'subscriptionId')::uuid = ${subscriptionId}`,
      ),
    );

  // Top sources for this scout's opportunities
  const topSourcesRows = await db
    .select({
      source: sql<string>`coalesce(${schema.objects.body}->>'source', 'unknown')`,
      count: count(),
    })
    .from(schema.objects)
    .where(
      and(
        eq(schema.objects.userId, userId),
        eq(schema.objects.type, 'opportunity'),
        isNull(schema.objects.archivedAt),
        sql`(${schema.objects.body}->>'subscriptionId')::uuid = ${subscriptionId}`,
      ),
    )
    .groupBy(sql`${schema.objects.body}->>'source'`)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  const counts = countsRow[0] ?? {
    total: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    last7: 0,
    last7Succeeded: 0,
  };

  return {
    totalRuns: Number(counts.total),
    succeededRuns: Number(counts.succeeded),
    failedRuns: Number(counts.failed),
    cancelledRuns: Number(counts.cancelled),
    last7DaysRuns: Number(counts.last7),
    last7DaysSucceeded: Number(counts.last7Succeeded),
    avgRuntimeMs: avgRow[0]?.avgMs != null ? Number(avgRow[0].avgMs) : null,
    opportunitiesCreated: Number(oppsCountRow[0]?.count ?? 0),
    topSources: topSourcesRows.map((r) => ({
      source: r.source,
      count: Number(r.count),
    })),
    lastSuccessAt: lastSuccessRow[0]?.at ?? null,
    lastRunAt: lastRunRow[0]?.at ?? null,
  };
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
