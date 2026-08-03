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

/**
 * Fetch a single subscription row by id (any user — callers scope the
 * lookup themselves; the run tracker uses it to attribute feed events).
 */
export async function getSubscriptionById(
  subscriptionId: string,
): Promise<{ id: string; name: string; target: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.subscriptions.id,
      name: schema.subscriptions.name,
      target: schema.subscriptions.target,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
    .limit(1);
  return row ?? null;
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
 * A dedicated-connection handle for the scheduler advisory lock.
 *
 * Postgres advisory locks are session-scoped: they live as long as
 * the connection that holds them. If we use the pooled drizzle
 * client, the pool may rotate the connection between calls, and
 * we'd lose the lock mid-tick.
 *
 * The fix: open a *dedicated* connection (bypassing the pool) for
 * the duration of the lock, and close it on release. The connection
 * lifecycle is bound to the lock — close it, drop the lock. This
 * is the standard pattern for postgres advisory locks; we just have
 * to be explicit about it.
 *
 * The class is the right shape because it makes the connection
 * lifecycle obvious to callers. `acquire()` returns a
 * SchedulerLock or null. If non-null, the caller owns the lock
 * and MUST call `release()` (which closes the connection). The
 * connection is also closed if the GC ever drops the reference,
 * via the registered finalizer — best-effort, in case the caller
 * forgot to release.
 */
import postgres from 'postgres';

// Minimal structural type for a reserved postgres.js connection.
// postgres.js's ReservedSql<TTypes> extends Sql<TTypes>; we narrow
// to the methods we actually use so we don't pull the full
// postgres types into the rest of the codebase.
type ReserveSql = {
  (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
  // Released (returned to the pool) via release(). To fully
  // destroy the client, call .end() on the parent Sql.
  release(): void;
};

export class SchedulerLock {
  private released = false;
  private readonly conn: ReserveSql;
  private readonly parentEnd: (opts?: { timeout?: number }) => Promise<void>;

  private constructor(conn: ReserveSql, parentEnd: (opts?: { timeout?: number }) => Promise<void>) {
    this.conn = conn;
    this.parentEnd = parentEnd;
  }

  static async acquire(): Promise<SchedulerLock | null> {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set');
    }
    // One-connection client. Keep it open for the lock's lifetime
    // and close it in release(). Re-creating on every tick is fine
    // (it's a 1-connection client, the cost is one TCP setup).
    const sql = postgres(url, { max: 1, prepare: false });
    try {
      const reserved = (await sql.reserve()) as unknown as ReserveSql;
      const rows = (await reserved`select pg_try_advisory_lock(${SCHEDULER_LOCK_KEY}) as ok`) as unknown[];
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row && (row as { ok?: boolean }).ok === true) {
        return new SchedulerLock(reserved, () => sql.end({ timeout: 1 }));
      }
      // Did not get the lock. Release the reserved connection and
      // close the client.
      reserved.release();
      try {
        await sql.end({ timeout: 1 });
      } catch {
        // ignore
      }
    } catch (err) {
      try {
        await sql.end({ timeout: 1 });
      } catch {
        // ignore
      }
      throw err;
    }
    return null;
  }

  /**
   * Release the lock and close the connection. Safe to call
   * multiple times — subsequent calls are no-ops.
   *
   * Closing the connection drops the session-scoped advisory lock
   * automatically. We still call pg_advisory_unlock explicitly
   * for clarity (and so the lock drops the instant release()
   * runs, not when the GC closes the connection).
   */
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    try {
      await this.conn`select pg_advisory_unlock(${SCHEDULER_LOCK_KEY})`;
    } catch {
      // ignore: connection may have died; lock is GC'd on close.
    } finally {
      try {
        this.conn.release();
      } catch {
        // ignore
      }
      try {
        await this.parentEnd();
      } catch {
        // ignore
      }
    }
  }
}

export async function forceReleaseSchedulerLock(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const conn = (await sql.reserve()) as unknown as ReserveSql;
    try {
      await conn`select pg_advisory_unlock(${SCHEDULER_LOCK_KEY})`;
    } catch {
      // ignore
    } finally {
      conn.release();
    }
  } catch {
    // DB unreachable; nothing to release
  } finally {
    try {
      await sql.end({ timeout: 1 });
    } catch {
      // ignore
    }
  }
}

let _activeLock: SchedulerLock | null = null;

export async function tryAcquireSchedulerLock(): Promise<boolean> {
  if (_activeLock) return false;
  const lock = await SchedulerLock.acquire();
  if (!lock) return false;
  _activeLock = lock;
  return true;
}

export async function releaseSchedulerLock(): Promise<void> {
  if (!_activeLock) return;
  await _activeLock.release();
  _activeLock = null;
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

// --- Context fetching (used to build the dispatch envelope) ---

/**
 * The 10 most recent active objects for a user, regardless of type.
 * Used as a starting point for a subscription's "related objects"
 * context. The skill decides what's actually relevant.
 */
export async function findRecentObjects(
  userId: string,
  limit = 10,
): Promise<Array<{
  id: string;
  type: schema.ObjectRow['type'];
  title: string;
  summary: string | null;
  status: schema.ObjectRow['status'];
  priority: number;
  updatedAt: Date;
}>> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.objects.id,
      type: schema.objects.type,
      title: schema.objects.title,
      summary: schema.objects.summary,
      status: schema.objects.status,
      priority: schema.objects.priority,
      updatedAt: schema.objects.updatedAt,
    })
    .from(schema.objects)
    .where(and(eq(schema.objects.userId, userId), isNull(schema.objects.archivedAt)))
    .orderBy(sql`${schema.objects.updatedAt} desc`)
    .limit(limit);
  return rows;
}

/**
 * Feedback rows for a user since a given timestamp, joined with the
 * object they refer to. Used for the subscription "recent_feedback"
 * context AND for the feedback-review context.
 */
export async function findRecentFeedback(
  userId: string,
  since: Date,
  limit = 50,
): Promise<Array<{
  id: string;
  kind: schema.Feedback['kind'];
  payload: Record<string, unknown>;
  createdAt: Date;
  object: {
    id: string;
    type: schema.ObjectRow['type'];
    title: string;
    summary: string | null;
    status: schema.ObjectRow['status'];
    priority: number;
  };
}>> {
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
      objStatus: schema.objects.status,
      objPriority: schema.objects.priority,
    })
    .from(schema.feedback)
    .innerJoin(schema.objects, eq(schema.feedback.objectId, schema.objects.id))
    .where(
      and(
        eq(schema.feedback.userId, userId),
        sql`${schema.feedback.createdAt} > ${since.toISOString()}`,
      ),
    )
    .orderBy(sql`${schema.feedback.createdAt} desc`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
    object: {
      id: r.objId,
      type: r.objType,
      title: r.objTitle,
      summary: r.objSummary,
      status: r.objStatus,
      priority: r.objPriority,
    },
  }));
}

/**
 * The most recent feed events for a user, since a given timestamp.
 * Used to know what the user has already seen in their Feed.
 */
export async function findRecentFeedEvents(
  userId: string,
  since: Date,
  limit = 50,
): Promise<Array<{
  id: string;
  kind: schema.FeedEvent['kind'];
  title: string;
  objectId: string | null;
  createdAt: Date;
}>> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.feedEvents.id,
      kind: schema.feedEvents.kind,
      title: schema.feedEvents.title,
      objectId: schema.feedEvents.objectId,
      createdAt: schema.feedEvents.createdAt,
    })
    .from(schema.feedEvents)
    .where(
      and(
        eq(schema.feedEvents.userId, userId),
        sql`${schema.feedEvents.createdAt} > ${since.toISOString()}`,
      ),
    )
    .orderBy(sql`${schema.feedEvents.createdAt} desc`)
    .limit(limit);
  return rows;
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
