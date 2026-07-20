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
import { type HermesClient } from './hermes-client.js';
import {
  emitRunFinishedFeedEvent,
  emitSystemNotification,
  feedbackSince,
  findActiveUsersWithDueWork,
  findDueSubscriptions,
  findRecentFeedEvents,
  findRecentFeedback,
  findRecentObjects,
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
  type DueSubscription,
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

function backoffMs(consecutiveFailures: number): number {
  // consecutive_failures is the new value (post-increment). So 1 -> 1m, 2 -> 5m, 3 -> 15m, 4+ -> 15m.
  const idx = Math.min(consecutiveFailures - 1, RETRY_BACKOFFS_MS.length - 1);
  return RETRY_BACKOFFS_MS[idx] ?? RETRY_BACKOFFS_MS[RETRY_BACKOFFS_MS.length - 1]!;
}

// ============================================================
// Dispatch envelope (Layer 2 — the thin dispatch prompt)
// ============================================================
//
// The envelope is a *thin* prompt: it answers "why this run exists"
// and ships the pre-collected context. Behavior lives in the
// hermieos skill bundle, not here. The scheduler is dumb.

export interface SubscriptionContext {
  subscription: {
    id: string;
    name: string;
    target: string;
    instruction: string;
    cadence: string;
    consecutive_failures: number;
    last_error: string | null;
  };
  related_objects: Array<{
    id: string;
    type: string;
    title: string;
    summary: string | null;
    status: string;
    priority: number;
    updated_at: string;
  }>;
  recent_feedback: Array<{
    kind: 'like' | 'save' | 'ignore' | 'archive' | 'suggest';
    payload: Record<string, unknown>;
    created_at: string;
    object: { id: string; type: string; title: string };
  }>;
  recent_activity: Array<{
    kind: string;
    title: string;
    object_id: string | null;
    created_at: string;
  }>;
}

export interface FeedbackReviewContext {
  since: string;
  feedback_rows: Array<{
    id: string;
    kind: 'like' | 'save' | 'ignore' | 'archive' | 'suggest';
    payload: Record<string, unknown>;
    created_at: string;
    object: {
      id: string;
      type: string;
      title: string;
      summary: string | null;
      status: string;
      priority: number;
    };
  }>;
}

export interface DispatchEnvelope {
  event: 'subscription' | 'feedback_review' | 'research';
  objective: string;
  context: SubscriptionContext | FeedbackReviewContext | Record<string, unknown>;
  trigger: 'cron' | 'user' | 'system';
}

function buildSubscriptionEnvelope(
  sub: DueSubscription,
  context: SubscriptionContext,
): DispatchEnvelope {
  return {
    event: 'subscription',
    objective: `Review this subscription for meaningful changes.`,
    context,
    trigger: 'cron',
  };
}

function buildFeedbackReviewEnvelope(
  since: Date,
  context: FeedbackReviewContext,
): DispatchEnvelope {
  return {
    event: 'feedback_review',
    objective: `Review the feedback accumulated since ${since.toISOString()} and update object priorities.`,
    context,
    trigger: 'cron',
  };
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

    // Build the dispatch envelope. The scheduler does the deterministic
    // pre-work: fetch the subscription's row, the user's recent objects,
    // recent feedback, and recent activity. Hermes does the reasoning.
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [relatedObjects, recentFeedback, recentActivity] = await Promise.all([
      findRecentObjects(userId, 10),
      findRecentFeedback(userId, sevenDaysAgo, 50),
      findRecentFeedEvents(userId, sevenDaysAgo, 50),
    ]);
    const context: SubscriptionContext = {
      subscription: {
        id: sub.id,
        name: sub.name,
        target: sub.target,
        instruction: sub.instruction,
        cadence: sub.cadence,
        consecutive_failures: sub.consecutiveFailures,
        last_error: sub.lastError,
      },
      related_objects: relatedObjects.map((o) => ({
        id: o.id,
        type: o.type,
        title: o.title,
        summary: o.summary,
        status: o.status,
        priority: o.priority,
        updated_at: o.updatedAt.toISOString(),
      })),
      recent_feedback: recentFeedback.map((f) => ({
        kind: f.kind,
        payload: f.payload,
        created_at: f.createdAt.toISOString(),
        object: {
          id: f.object.id,
          type: f.object.type,
          title: f.object.title,
        },
      })),
      recent_activity: recentActivity.map((e) => ({
        kind: e.kind,
        title: e.title,
        object_id: e.objectId,
        created_at: e.createdAt.toISOString(),
      })),
    };
    const envelope = buildSubscriptionEnvelope(sub, context);

    const { id: runId } = await recordRunStart({
      userId,
      kind: 'subscription',
      subscriptionId: sub.id,
      prompt: JSON.stringify(envelope),
    });

    if (opts.dryRun) {
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
        // The agent sees the JSON envelope as the "input" and reads
        // the hermieos orchestrator skill to know what to do with it.
        input: JSON.stringify(envelope),
      });
      await markRunDispatched(runId, dispatched.hermesRunId, new Date());

      // The run tracker (run-tracker.ts) takes it from here.
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

  // Build the envelope. The feedback-review context is the raw
  // feedback rows since the last review, joined with the full
  // object rows. Counts throw away the kinds and notes; the agent
  // needs the structured rows to update priorities meaningfully.
  const feedbackRows = await findRecentFeedback(userId, since, 200);
  if (feedbackRows.length === 0) return;
  const context: FeedbackReviewContext = {
    since: since.toISOString(),
    feedback_rows: feedbackRows.map((f) => ({
      id: f.id,
      kind: f.kind,
      payload: f.payload,
      created_at: f.createdAt.toISOString(),
      object: {
        id: f.object.id,
        type: f.object.type,
        title: f.object.title,
        summary: f.object.summary,
        status: f.object.status,
        priority: f.object.priority,
      },
    })),
  };
  const envelope = buildFeedbackReviewEnvelope(since, context);

  const { id: runId } = await recordRunStart({
    userId,
    kind: 'feedback_review',
    prompt: JSON.stringify(envelope),
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
      input: JSON.stringify(envelope),
    });
    await markRunDispatched(runId, dispatched.hermesRunId, new Date());
    // The run tracker settles this run. Feedback review doesn't have
    // a "subscription" so the tracker just marks succeeded/failed
    // on hermes_runs; the agent's MCP calls have already updated
    // the object priorities.
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
