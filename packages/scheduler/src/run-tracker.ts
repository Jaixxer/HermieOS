/**
 * Run tracker.
 *
 * Background task that polls Hermes for the status of dispatched
 * runs and reconciles the local `hermes_runs` table with the
 * gateway's view.
 *
 * Replaces the optimistic "mark as succeeded after dispatch" in
 * tick.ts. Now:
 *   tick.ts  -> recordRunStart + dispatchRun + markRunDispatched
 *   tracker  -> polls getRun, settles the run, advances subscriptions
 *
 * The tracker is idempotent. A run that's already terminal in our
 * table is not re-polled. A run that's been 'running' for more than
 * `deadlineMs` is force-stopped and marked cancelled.
 *
 * Public surface:
 *   - trackRunsOnce(client, opts): one pass through the due runs
 *   - startRunTracker(client, opts): setInterval-based loop
 *
 * The tracker runs in the same process as the tick loop, so it
 * shares the DB and the single-instance advisory lock. The two
 * tasks do not contend (different SQL tables).
 */
import { and, inArray, isNull, isNotNull, lte } from 'drizzle-orm';
import { RETRY_BACKOFFS_MS } from '@hermieos/domain';
import { schema } from '@hermieos/db';
import {
  type HermesClient,
  isSuccessRunStatus,
  isTerminalRunStatus,
} from '@hermieos/gateway';
import {
  emitRunFinishedFeedEvent,
  getDb,
  getSubscriptionById,
  markRunCancelled,
  markRunFailed,
  markRunSucceeded,
  markSubscriptionFailed,
  markSubscriptionSucceeded,
} from './db.js';
import type { Database } from '@hermieos/db';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_DEADLINE_MS = 5 * 60_000; // 5 minutes
const DEFAULT_BATCH = 25;

export interface RunTrackerOptions {
  /** How often to scan for in-flight runs. Default 5_000. */
  pollIntervalMs?: number;
  /** Force-stop a run if it has been 'running' longer than this. Default 5min. */
  deadlineMs?: number;
  /** Override the DB. */
  dbOverride?: Database;
}

export interface RunTrackerSummary {
  startedAt: Date;
  finishedAt: Date;
  runsScanned: number;
  runsPolled: number;
  runsSettled: number;
  runsFailed: number;
  runsCancelled: number;
  runsStopForced: number;
  errors: number;
}

export interface InFlightRun {
  id: string;
  userId: string;
  kind: schema.HermesRun['kind'];
  subscriptionId: string | null;
  hermesRunId: string;
  startedAt: Date;
  /** Number of consecutive failed polls (for backoff / observability). */
  pollFailures: number;
}

/**
 * Find runs that are dispatched or running and have a hermesRunId.
 */
export async function findInFlightRuns(
  db: Database,
  batch = DEFAULT_BATCH,
): Promise<InFlightRun[]> {
  const rows = await db
    .select({
      id: schema.hermesRuns.id,
      userId: schema.hermesRuns.userId,
      kind: schema.hermesRuns.kind,
      subscriptionId: schema.hermesRuns.subscriptionId,
      hermesRunId: schema.hermesRuns.hermesRunId,
      startedAt: schema.hermesRuns.startedAt,
    })
    .from(schema.hermesRuns)
    .where(
      and(
        inArray(schema.hermesRuns.status, ['dispatched', 'running']),
        isNotNull(schema.hermesRuns.hermesRunId),
      ),
    )
    .orderBy(schema.hermesRuns.createdAt)
    .limit(batch);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    kind: r.kind,
    subscriptionId: r.subscriptionId,
    hermesRunId: r.hermesRunId!,
    startedAt: r.startedAt ?? new Date(),
    pollFailures: 0,
  }));
}

/**
 * Walk one batch of in-flight runs, poll each, settle the terminal
 * ones, and force-stop any past their deadline.
 *
 * Safe to call concurrently with itself (idempotent at the row
 * level: a run that's already terminal is filtered out of the
 * findInFlightRuns query).
 */
export async function trackRunsOnce(
  client: HermesClient,
  opts: RunTrackerOptions & { now?: () => Date } = {},
): Promise<RunTrackerSummary> {
  const startedAt = opts.now ? opts.now().getTime() : Date.now();
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const db = opts.dbOverride ?? getDb();
  const summary: RunTrackerSummary = {
    startedAt: new Date(startedAt),
    finishedAt: new Date(),
    runsScanned: 0,
    runsPolled: 0,
    runsSettled: 0,
    runsFailed: 0,
    runsCancelled: 0,
    runsStopForced: 0,
    errors: 0,
  };

  const inFlight = await findInFlightRuns(db);
  summary.runsScanned = inFlight.length;
  if (inFlight.length === 0) {
    summary.finishedAt = new Date();
    return summary;
  }

  const now = startedAt;
  for (const run of inFlight) {
    // Has it been running longer than the deadline? Force-stop and mark cancelled.
    const runStartedMs = run.startedAt instanceof Date
      ? run.startedAt.getTime()
      : Number(run.startedAt);
    const elapsed = now - runStartedMs;
    if (elapsed > deadlineMs) {
      try {
        await client.stopRun(run.hermesRunId);
        summary.runsStopForced += 1;
      } catch (err) {
        // best effort — even if stopRun fails, we still mark cancelled
        // so the run doesn't sit in 'running' forever
        summary.errors += 1;
        // eslint-disable-next-line no-console
        console.warn(`tracker: stopRun failed for ${run.hermesRunId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await markRunCancelled(run.id);
      await emitRunFinishedFeedEvent(run.userId, {
        runId: run.id,
        subscriptionId: run.subscriptionId,
        status: 'cancelled',
        title: 'Run timed out',
        body: `Run ${run.hermesRunId} exceeded the ${Math.round(deadlineMs / 1000)}s deadline.`,
        payload: { reason: 'deadline', deadlineMs },
      });
      // subscription: a forced cancel is a failure for retry purposes
      if (run.subscriptionId) {
        const result = await markSubscriptionFailed(
          run.subscriptionId,
          'deadline exceeded',
          backoffMsFor(1),
          new Date(now),
        );
        if (result.autoPaused) {
          // best effort: emit a system notification; the rate limit applies
          await db
            .insert(schema.feedEvents)
            .values({
              userId: run.userId,
              kind: 'task_finished',
              objectId: null,
              title: 'Subscription auto-paused after deadline',
              body: `Subscription ${run.subscriptionId} paused after 3 consecutive deadline failures.`,
              payload: { subscriptionId: run.subscriptionId, reason: 'deadline' },
            })
            .onConflictDoNothing();
        }
      }
      summary.runsCancelled += 1;
      continue;
    }

    // Otherwise, poll the run's status.
    try {
      const status = await client.getRun(run.hermesRunId);
      summary.runsPolled += 1;
      if (!isTerminalRunStatus(status.status)) {
        continue;
      }
      if (isSuccessRunStatus(status.status)) {
        await markRunSucceeded(run.id);
        if (run.subscriptionId) {
          await markSubscriptionSucceeded(run.subscriptionId, new Date(now));
          // Every successful scout run surfaces in the Feed — including
          // no-op runs ("Watched <target>. No new findings.") so the
          // user can see the scout actually ran. The body is the
          // agent's own terse summary when Hermes produced one.
          const sub = await getSubscriptionById(run.subscriptionId);
          if (sub) {
            const output = status.output?.trim();
            const body = output
              ? output.slice(0, 500)
              : `Watched ${sub.target}. Run completed with no summary.`;
            await db.insert(schema.feedEvents).values({
              userId: run.userId,
              kind: 'task_finished',
              objectId: null,
              title: `Scout "${sub.name}" ran`,
              body,
              payload: {
                runId: run.id,
                subscriptionId: run.subscriptionId,
                hermesRunId: run.hermesRunId,
                status: 'succeeded',
                output: output ?? null,
              },
            });
          }
        }
        summary.runsSettled += 1;
      } else if (status.status === 'failed') {
        await markRunFailed(run.id, status.error ?? 'failed', new Date(now));
        if (run.subscriptionId) {
          const result = await markSubscriptionFailed(
            run.subscriptionId,
            status.error ?? 'run failed',
            backoffMsFor(1),
            new Date(now),
          );
          if (result.autoPaused) {
            await db
              .insert(schema.feedEvents)
              .values({
                userId: run.userId,
                kind: 'task_finished',
                objectId: null,
                title: 'Subscription auto-paused',
                body: `Subscription ${run.subscriptionId} paused after 3 consecutive failures.`,
                payload: { subscriptionId: run.subscriptionId, reason: 'auto-pause' },
              })
              .onConflictDoNothing();
          }
        }
        await emitRunFinishedFeedEvent(run.userId, {
          runId: run.id,
          subscriptionId: run.subscriptionId,
          status: 'failed',
          title: 'Run failed',
          body: status.error ?? 'Hermes returned failed',
          payload: { hermesRunId: run.hermesRunId, status: status.status },
        });
        summary.runsFailed += 1;
      } else if (status.status === 'cancelled') {
        await markRunCancelled(run.id);
        if (run.subscriptionId) {
          await markSubscriptionFailed(
            run.subscriptionId,
            'run cancelled',
            backoffMsFor(1),
            new Date(now),
          );
        }
        summary.runsCancelled += 1;
      }
    } catch (err) {
      summary.errors += 1;
      // eslint-disable-next-line no-console
      console.warn(`tracker: getRun failed for ${run.hermesRunId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  summary.finishedAt = new Date();
  return summary;
}

function backoffMsFor(consecutiveFailures: number): number {
  const idx = Math.min(consecutiveFailures - 1, RETRY_BACKOFFS_MS.length - 1);
  return RETRY_BACKOFFS_MS[idx] ?? RETRY_BACKOFFS_MS[RETRY_BACKOFFS_MS.length - 1]!;
}

export function startRunTracker(
  client: HermesClient,
  opts: RunTrackerOptions = {},
): { stop: () => void } {
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const log = createLogger();
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const summary = await trackRunsOnce(client, opts);
      if (summary.runsScanned > 0) {
        log.info(
          {
            scanned: summary.runsScanned,
            polled: summary.runsPolled,
            settled: summary.runsSettled,
            failed: summary.runsFailed,
            cancelled: summary.runsCancelled,
            stopForced: summary.runsStopForced,
            errors: summary.errors,
          },
          'run tracker tick',
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('run tracker tick failed:', err);
    }
  };

  // Fire one immediately, then on interval.
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  // Don't keep the process alive solely for the tracker.
  if (typeof handle === 'object' && handle && 'unref' in handle && typeof handle.unref === 'function') {
    handle.unref();
  }

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}

function createLogger(): { info: (obj: object, msg: string) => void } {
  // Avoid a hard import on pino here; if the caller has set up a
  // logger, it ends up in stdout. We just use console.
  return {
    info: (obj, msg) => {
      // eslint-disable-next-line no-console
      console.log(`[run-tracker] ${msg} ${JSON.stringify(obj)}`);
    },
  };
}

// silence unused
void isNull;
void lte;
