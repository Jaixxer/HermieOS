import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createDatabase, schema, type Database } from '@hermieos/db';
import { CADENCE_INTERVALS_MS } from '@hermieos/domain';

let _db: Database | null = null;
export function getDb(): Database {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _db = createDatabase({ url });
  }
  return _db;
}
export function setDb(db: Database): void {
  _db = db;
}

// --- Subscription queries ---

export interface DueSubscription {
  id: string;
  userId: string;
  name: string;
  target: string;
  instruction: string;
  cadence: string;
  nextRunAt: Date;
  lastRunAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  status: schema.Subscription['status'];
}

function rowToSubscription(row: schema.Subscription): DueSubscription {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    target: row.target,
    instruction: row.instruction,
    cadence: row.cadence,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
    status: row.status,
  };
}

export async function findDueSubscriptions(
  userId: string,
  now: Date = new Date(),
  limit = 25,
): Promise<DueSubscription[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.userId, userId),
        eq(schema.subscriptions.status, 'active'),
        lte(schema.subscriptions.nextRunAt, now),
        or(
          isNull(schema.subscriptions.nextRetryAt),
          lte(schema.subscriptions.nextRetryAt, now),
        ),
      ),
    )
    .orderBy(asc(schema.subscriptions.nextRunAt))
    .limit(limit);
  return rows.map(rowToSubscription);
}

export async function listActiveUsers(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.schedulerEnabled, true), isNull(schema.users.archivedAt)));
  return rows.map((r) => r.id);
}

export async function markSubscriptionSucceeded(
  subscriptionId: string,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb();
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
    .limit(1);
  if (!sub) return;
  const nextRunAt = computeNextRunAt(sub.cadence, now);
  await db
    .update(schema.subscriptions)
    .set({
      lastRunAt: now,
      nextRunAt,
      nextRetryAt: null,
      consecutiveFailures: 0,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(schema.subscriptions.id, subscriptionId));
}

export async function markSubscriptionFailed(
  subscriptionId: string,
  error: string,
  backoffMs: number,
  now: Date = new Date(),
): Promise<{ consecutiveFailures: number; autoPaused: boolean }> {
  const db = getDb();
  return await db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subscriptionId))
      .limit(1);
    if (!sub) return { consecutiveFailures: 0, autoPaused: false };
    const next = sub.consecutiveFailures + 1;
    const autoPause = next >= 3;
    const nextRetry = new Date(now.getTime() + backoffMs);
    await tx
      .update(schema.subscriptions)
      .set({
        consecutiveFailures: next,
        lastError: error,
        nextRetryAt: nextRetry,
        nextRunAt: autoPause ? nextRetry : nextRetry, // both = nextRetry when auto-paused; otherwise the scheduler sees next_retry_at first
        status: autoPause ? 'paused' : sub.status,
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.id, subscriptionId));
    return { consecutiveFailures: next, autoPaused: autoPause };
  });
}

function computeNextRunAt(cadence: string, from: Date): Date {
  if (cadence.startsWith('cron:')) return from; // not implemented in MVP
  const interval = CADENCE_INTERVALS_MS[cadence];
  if (interval === null || interval === undefined) throw new Error(`unknown cadence: ${cadence}`);
  return new Date(from.getTime() + interval);
}

// --- Hermes-run lifecycle ---

export interface RunStartInput {
  userId: string;
  kind: 'subscription' | 'feedback_review' | 'system_notify' | 'ad_hoc';
  subscriptionId?: string;
  prompt: string;
  attempt?: number;
}

export async function recordRunStart(input: RunStartInput): Promise<{ id: string }> {
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

export async function markRunSucceeded(
  runId: string,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.hermesRuns)
    .set({ status: 'succeeded', finishedAt: now, error: null })
    .where(eq(schema.hermesRuns.id, runId));
}

export async function markRunFailed(
  runId: string,
  error: string,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.hermesRuns)
    .set({ status: 'failed', finishedAt: now, error })
    .where(eq(schema.hermesRuns.id, runId));
}

export async function markRunCancelled(
  runId: string,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.hermesRuns)
    .set({ status: 'cancelled', finishedAt: now, error: 'cancelled by deadline' })
    .where(eq(schema.hermesRuns.id, runId));
}

// --- Feed events (for failed-run events) ---

export async function emitRunFinishedFeedEvent(
  userId: string,
  input: {
    runId: string;
    subscriptionId: string | null;
    status: 'failed' | 'cancelled' | 'succeeded';
    title: string;
    body?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const db = getDb();
  await db.insert(schema.feedEvents).values({
    userId,
    kind: 'task_finished',
    objectId: null,
    title: input.title,
    body: input.body ?? null,
    payload: {
      runId: input.runId,
      subscriptionId: input.subscriptionId,
      status: input.status,
      ...(input.payload ?? {}),
    },
  });
}

// --- Feedback review ---

/**
 * Returns the id of the most recent feedback_review run for the user, if
 * any. We use this to know whether feedback has accumulated since the
 * last review.
 */
export async function lastFeedbackReviewRun(
  userId: string,
): Promise<schema.HermesRun | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hermesRuns)
    .where(
      and(
        eq(schema.hermesRuns.userId, userId),
        eq(schema.hermesRuns.kind, 'feedback_review'),
      ),
    )
    .orderBy(sql`${schema.hermesRuns.createdAt} desc`)
    .limit(1);
  return row ?? null;
}

export async function feedbackSince(
  userId: string,
  since: Date,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.feedback.id })
    .from(schema.feedback)
    .where(
      and(eq(schema.feedback.userId, userId), sql`${schema.feedback.createdAt} > ${since.toISOString()}`),
    );
  return rows.length;
}

// --- System-notify dispatch (third-failure alert) ---

/**
 * Insert a notification row directly. This is the scheduler's escape hatch:
 * the third-failure auto-pause alerts the user, but the scheduler does
 * not have a way to call mcp_hermieos_notify_user (it would need the
 * user's mcp_token). Instead, we write the notification directly and
 * also emit a feed_event so the user sees it in the Feed.
 *
 * This honors the rate limit (NOTIFY_USER_DAILY_LIMIT = 5) by simply
 * counting today's notifications before writing.
 *
 * Returns true if the notification was created, false if rate-limited.
 */
export async function emitSystemNotification(
  userId: string,
  input: { title: string; message: string; priority: 'low' | 'normal' | 'high' },
  limit: number,
): Promise<{ created: boolean }> {
  const db = getDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const existing = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        sql`${schema.notifications.createdAt} >= ${start.toISOString()}`,
      ),
    );
  if (existing.length >= limit) {
    return { created: false };
  }
  await db.insert(schema.notifications).values({
    userId,
    title: input.title,
    message: input.message,
    priority: input.priority,
  });
  await db.insert(schema.feedEvents).values({
    userId,
    kind: 'notification',
    title: input.title,
    body: input.message,
    payload: { priority: input.priority, source: 'scheduler-system-notify' },
  });
  return { created: true };
}

// --- Single-instance lock ---

const SCHEDULER_LOCK_KEY = 91337; // arbitrary 32-bit int

/**
 * Try to acquire a Postgres advisory lock so only one scheduler process
 * ticks at a time. Returns true if we got it.
 *
 * The lock is session-scoped (released when the connection closes).
 * We hold it for the duration of a single tick; if the tick crashes
 * mid-way, Postgres releases it on connection close.
 */
export async function tryAcquireSchedulerLock(): Promise<boolean> {
  const db = getDb();
  const rows = await db.$client<{ ok: boolean }[]>`
    select pg_try_advisory_lock(${SCHEDULER_LOCK_KEY}) as ok
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  return row?.ok === true;
}

export async function releaseSchedulerLock(): Promise<void> {
  const db = getDb();
  await db.$client`select pg_advisory_unlock(${SCHEDULER_LOCK_KEY})`;
}

// --- Per-user mcp_token lookup (for system_notify path) ---

export async function getMcpToken(userId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ token: schema.users.mcpToken })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.token ?? null;
}

// --- Batched user iteration ---

export async function findActiveUsersWithDueWork(now: Date = new Date()): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(
      schema.subscriptions,
      and(
        eq(schema.subscriptions.userId, schema.users.id),
        eq(schema.subscriptions.status, 'active'),
        lte(schema.subscriptions.nextRunAt, now),
        or(
          isNull(schema.subscriptions.nextRetryAt),
          lte(schema.subscriptions.nextRetryAt, now),
        ),
      ),
    )
    .where(
      and(
        eq(schema.users.schedulerEnabled, true),
        isNull(schema.users.archivedAt),
      ),
    );
  return rows.map((r) => r.id);
}

export async function listUsersWithEnabledScheduler(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.users.id, enabled: schema.users.schedulerEnabled })
    .from(schema.users);
  return rows.filter((r) => r.enabled).map((r) => r.id);
}

export async function _setUserSchedulerEnabled(
  userId: string,
  enabled: boolean,
): Promise<void> {
  const db = getDb();
  await db.update(schema.users).set({ schedulerEnabled: enabled }).where(eq(schema.users.id, userId));
}

export async function _invalidateUsers(
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const db = getDb();
  await db.update(schema.users).set({ schedulerEnabled: false }).where(inArray(schema.users.id, userIds));
}

// silence unused-warning
void lt;
