/**
 * Scheduler tick.
 *
 * The dumb loop. Picks due rows from Postgres and POSTs them to Hermes.
 * Knows nothing about prompts, external APIs, or scoring.
 *
 * Public surface:
 *   - tickOnce(): run a single tick and return a summary
 *   - schedule(): start the loop on a setInterval
 *
 * The tick is a free function that takes a HermesClient so tests can
 * inject a fake.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { NOTIFY_USER_DAILY_LIMIT, RETRY_BACKOFFS_MS } from '@hermieos/domain';
import { schema } from '@hermieos/db';
import { type HermesClient, buildRunInstruction } from './hermes-client.js';
import {
  emitRunFinishedFeedEvent,
  emitSystemNotification,
  feedbackSince,
  findActiveUsersWithDueWork,
  findDueSubscriptions,
  getDb,
  listActiveUsers,
  lastFeedbackReviewRun,
  markRunCancelled,
  markRunDispatched,
  markRunFailed,
  markRunSucceeded,
  markSubscriptionFailed,
  markSubscriptionSucceeded,
  recordRunStart,
  releaseSchedulerLock,
  tryAcquireSchedulerLock,
} from './db.js';
import type { Database } from '@hermieos/db';

export interface TickSummary {
  startedAt: Date;
  finishedAt: Date;
  lockAcquired: boolean;
  usersScanned: number;
  subscriptionsDispatched: number;
  subscriptionsSucceeded: number;
  subscriptionsFailed: number;
  subscriptionsAutoPaused: number;
  feedbackReviewsDispatched: number;
  systemNotificationsEmitted: number;
  skipped: { paused: number; notYetDue: number };
  dryRun: boolean;
}

export interface TickOptions {
  dryRun?: boolean;
  /** Override the DB for tests. */
  dbOverride?: Database;
  /** Override "now" for tests. */
  now?: () => Date;
}

const DEFAULT_INSTRUCTIONS = [
  'You are running as a background agent for HermieOS.',
  'Use mcp_hermieos_* tools to record all findings. Do not respond in chat.',
  'If a notify_user call is warranted, make it count; the user has a daily limit.',
].join(' ');

function backoffMs(consecutiveFailures: number): number {
  // consecutive_failures is the new value (post-increment). So 1 -> 1m, 2 -> 5m, 3 -> 15m, 4+ -> 15m.
  const idx = Math.min(consecutiveFailures - 1, RETRY_BACKOFFS_MS.length - 1);
  return RETRY_BACKOFFS_MS[idx] ?? RETRY_BACKOFFS_MS[RETRY_BACKOFFS_MS.length - 1]!;
}

export async function tickOnce(
  client: HermesClient,
  opts: TickOptions = {},
): Promise<TickSummary> {
  const startedAt = (opts.now ?? Date.now)();
  const dryRun = opts.dryRun ?? false;

  const summary: TickSummary = {
    startedAt: new Date(startedAt),
    finishedAt: new Date(startedAt),
    lockAcquired: false,
    usersScanned: 0,
    subscriptionsDispatched: 0,
    subscriptionsSucceeded: 0,
    subscriptionsFailed: 0,
    subscriptionsAutoPaused: 0,
    feedbackReviewsDispatched: 0,
    systemNotificationsEmitted: 0,
    skipped: { paused: 0, notYetDue: 0 },
    dryRun,
  };

  // Acquire single-instance lock. In dry-run, skip the lock to make
  // local testing less painful.
  if (!dryRun) {
    summary.lockAcquired = await tryAcquireSchedulerLock();
    if (!summary.lockAcquired) {
      summary.finishedAt = new Date();
      return summary;
    }
  } else {
    summary.lockAcquired = true;
  }

  try {
    await runTick(client, summary, opts);
  } finally {
    if (!dryRun) {
      try {
        await releaseSchedulerLock();
      } catch {
        // ignore: connection may have died, the lock will release on close
      }
    }
    summary.finishedAt = new Date();
  }

  return summary;
}

async function runTick(
  client: HermesClient,
  summary: TickSummary,
  opts: TickOptions,
): Promise<void> {
  const now = new Date((opts.now ?? Date.now)());

  // Users with due subscriptions: dispatch them, then dispatch their
  // feedback review (if any) as a side effect.
  const usersWithDue = await findActiveUsersWithDueWork(now);
  summary.usersScanned = usersWithDue.length;
  for (const userId of usersWithDue) {
    await dispatchSubscriptionsForUser(client, userId, now, summary, opts);
    await dispatchFeedbackReviewIfPending(client, userId, now, summary, opts);
  }

  // Users without due subscriptions may still have feedback to review.
  // Walk all enabled users and dispatch feedback reviews for those that
  // weren't covered above.
  const allActive = await listActiveUsers();
  for (const userId of allActive) {
    if (usersWithDue.includes(userId)) continue;
    await dispatchFeedbackReviewIfPending(client, userId, now, summary, opts);
  }
}

async function dispatchSubscriptionsForUser(
  client: HermesClient,
  userId: string,
  now: Date,
  summary: TickSummary,
  opts: TickOptions,
): Promise<void> {
  const due = await findDueSubscriptions(userId, now);
  for (const sub of due) {
    // Per-subscription serialization: if a previous run for this subscription
    // is still in flight, skip.
    const db = getDb();
    const inFlight = await db
      .select({ id: schema.hermesRuns.id })
      .from(schema.hermesRuns)
      .where(
        sql`${schema.hermesRuns.subscriptionId} = ${sub.id} and ${schema.hermesRuns.status} in ('dispatched', 'running')`,
      )
      .limit(1);
    if (inFlight.length > 0) {
      summary.skipped.notYetDue += 1;
      continue;
    }

    summary.subscriptionsDispatched += 1;

    const { id: runId } = await recordRunStart({
      userId,
      kind: 'subscription',
      subscriptionId: sub.id,
      prompt: sub.instruction,
    });

    if (opts.dryRun) {
      // Mark succeeded so the test path runs end-to-end without a real Hermes.
      await markRunDispatched(runId, `dry-run-${runId}`, now);
      await markRunSucceeded(runId, new Date());
      await markSubscriptionSucceeded(sub.id, new Date());
      summary.subscriptionsSucceeded += 1;
      continue;
    }

    try {
      const dispatched = await client.dispatchRun({
        hermieosRunId: runId,
        userId,
        kind: 'subscription',
        input: buildRunInstruction('subscription', sub.instruction),
        instructions: DEFAULT_INSTRUCTIONS,
      });
      await markRunDispatched(runId, dispatched.hermesRunId, new Date());

      // The run tracker (run-tracker.ts) takes it from here. It polls
      // Hermes for status, settles the run as succeeded/failed/cancelled,
      // and advances the subscription's next_run_at on success or applies
      // backoff on failure. The tick loop's job is to dispatch and get
      // out of the way; reconciliation happens in the tracker.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markRunFailed(runId, msg, new Date());
      const result = await markSubscriptionFailed(sub.id, msg, backoffMs(sub.consecutiveFailures + 1), new Date());
      summary.subscriptionsFailed += 1;
      await emitRunFinishedFeedEvent(userId, {
        runId,
        subscriptionId: sub.id,
        status: 'failed',
        title: `Subscription "${sub.name}" failed`,
        body: msg.slice(0, 500),
        payload: { consecutiveFailures: result.consecutiveFailures },
      });
      if (result.autoPaused) {
        summary.subscriptionsAutoPaused += 1;
        const n = await emitSystemNotification(
          userId,
          {
            title: `Subscription "${sub.name}" auto-paused`,
            message: `It failed 3 times in a row. Last error: ${msg.slice(0, 200)}`,
            priority: 'high',
          },
          NOTIFY_USER_DAILY_LIMIT,
        );
        if (n.created) summary.systemNotificationsEmitted += 1;
      }
    }
  }
}

async function dispatchFeedbackReviewIfPending(
  client: HermesClient,
  userId: string,
  now: Date,
  summary: TickSummary,
  opts: TickOptions,
): Promise<void> {
  const last = await lastFeedbackReviewRun(userId);
  const since = last?.createdAt ?? new Date(0);
  const pending = await feedbackSince(userId, since);
  if (pending === 0) return;

  // Don't dispatch a feedback review if we already have one in flight.
  const db = getDb();
  const inFlight = await db
    .select({ id: schema.hermesRuns.id })
    .from(schema.hermesRuns)
    .where(
      sql`${schema.hermesRuns.userId} = ${userId} and ${schema.hermesRuns.kind} = 'feedback_review' and ${schema.hermesRuns.status} in ('dispatched', 'running')`,
    )
    .limit(1);
  if (inFlight.length > 0) return;

  const { id: runId } = await recordRunStart({
    userId,
    kind: 'feedback_review',
    prompt: `Review ${pending} feedback signal(s) and update the user model.`,
  });
  summary.feedbackReviewsDispatched += 1;

  if (opts.dryRun) {
    await markRunDispatched(runId, `dry-run-${runId}`, new Date());
    await markRunSucceeded(runId, new Date());
    return;
  }

  try {
    const dispatched = await client.dispatchRun({
      hermieosRunId: runId,
      userId,
      kind: 'feedback_review',
      input: buildRunInstruction(
        'feedback_review',
        `Review ${pending} feedback signal(s) accumulated since ${
          last?.createdAt?.toISOString() ?? 'the beginning of time'
        }. Update the user model and re-rank existing Feed items.`,
      ),
      instructions: DEFAULT_INSTRUCTIONS,
    });
    await markRunDispatched(runId, dispatched.hermesRunId, new Date());
    await markRunSucceeded(runId, new Date());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markRunFailed(runId, msg, new Date());
  }
}

export interface SchedulerHandle {
  stop(): void;
  /** Run a single tick on demand (test-friendly). */
  tickNow(): Promise<TickSummary>;
}

/**
 * Start the loop on a setInterval. The first tick fires after `tickMs`,
 * not immediately (the first tick in tests should be explicit).
 */
export function schedule(
  client: HermesClient,
  tickMs: number,
  opts: TickOptions = {},
): SchedulerHandle {
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async (): Promise<TickSummary> => {
    if (running) {
      // Already in flight; return an empty summary.
      const now = new Date((opts.now ?? Date.now)());
      return {
        startedAt: now,
        finishedAt: now,
        lockAcquired: false,
        usersScanned: 0,
        subscriptionsDispatched: 0,
        subscriptionsSucceeded: 0,
        subscriptionsFailed: 0,
        subscriptionsAutoPaused: 0,
        feedbackReviewsDispatched: 0,
        systemNotificationsEmitted: 0,
        skipped: { paused: 0, notYetDue: 0 },
        dryRun: opts.dryRun ?? false,
      };
    }
    running = true;
    try {
      return await tickOnce(client, opts);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => {
    void tick();
  }, tickMs);
  timer.unref?.();
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tickNow: tick,
  };
}
