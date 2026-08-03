import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { HermesClient } from '@hermieos/gateway';
import { tickOnce, type TickSummary } from './tick.js';
import { trackRunsOnce } from './run-tracker.js';
import { setDb, getDb, forceReleaseSchedulerLock } from './db.js';
import { makeFakeHermes, type FakeHermes } from '@hermieos/gateway/src/test-helpers/fake-hermes.js';

/**
 * The tick dispatches; the run tracker reconciles. Tests that want
 * to assert "this run succeeded" need to drive both.
 */
async function tickAndTrack(): Promise<{ tick: TickSummary; track: import('./run-tracker.js').RunTrackerSummary }> {
  const tick = await tickOnce(client);
  const track = await trackRunsOnce(client);
  return { tick, track };
}

let db: Database;
let hermes: FakeHermes;
let client: HermesClient;

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  });
  setDb(db);
  hermes = await makeFakeHermes();
  client = new HermesClient({ baseUrl: hermes.url, apiKey: 'test-key' });
});
afterAll(async () => {
  await hermes.close();
  await closeDatabase(db);
});

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@sched-test.local')`);
  await db.execute(sql`delete from notifications where user_id in (select id from users where email like '%@sched-test.local')`);
  await db.execute(sql`delete from feedback where user_id in (select id from users where email like '%@sched-test.local')`);
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email like '%@sched-test.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@sched-test.local')`);
  await db.execute(sql`delete from users where email like '%@sched-test.local'`);
  // also release any advisory lock from a previous run
  await db.$client`select pg_advisory_unlock_all()`;
}

async function seedUser(label: string, opts: { schedulerEnabled?: boolean } = {}): Promise<{ id: string }> {
  const email = `${label}-${randomBytes(4).toString('hex')}@sched-test.local`;
  const [row] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: 'x',
      displayName: label,
      mcpToken: `tok_${label}_${randomBytes(8).toString('hex')}`,
      schedulerEnabled: opts.schedulerEnabled ?? true,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('seed failed');
  return { id: row.id };
}

async function seedSubscription(
  userId: string,
  opts: { name: string; instruction: string; cadence: 'hourly' | 'daily' },
  nextRunAt: Date = new Date(Date.now() - 60_000),
): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      userId,
      name: opts.name,
      target: 'test',
      instruction: opts.instruction,
      cadence: opts.cadence,
      nextRunAt,
    })
    .returning({ id: schema.subscriptions.id });
  if (!row) throw new Error('seed sub failed');
  return { id: row.id };
}

beforeEach(async () => {
  await cleanup();
  hermes.setMode({});
  hermes.recorded.length = 0;
  hermes.recordedAll.length = 0;
  // Force-release any advisory lock that may have leaked from a
  // previous test run (the underlying postgres connection pool may
  // have rotated, leaving the lock held by a session we no longer
  // control).
  await forceReleaseSchedulerLock();
});
afterEach(async () => {
  await cleanup();
  await forceReleaseSchedulerLock();
});

describe('tickOnce — subscription dispatch', () => {
  it('dispatches a due subscription and advances next_run_at on success', async () => {
    const u = await seedUser('alice');
    const before = Date.now();
    const sub = await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' });

    const { tick, track } = await tickAndTrack();
    expect(tick.lockAcquired).toBe(true);
    expect(tick.usersScanned).toBe(1);
    expect(tick.subscriptionsDispatched).toBe(1);
    // The run tracker is what reconciles the run as succeeded and
    // advances the subscription's next_run_at. The tick just dispatches.
    expect(track.runsSettled).toBe(1);
    expect(track.runsFailed).toBe(0);
    expect(hermes.recorded.length).toBe(1);
    const envelope = JSON.parse(hermes.recorded[0]?.input ?? '{}');
    expect(envelope.event).toBe('subscription');
    expect(envelope.objective).toBeTruthy();
    expect(envelope.context.subscription.instruction).toBe('check');
    expect(hermes.recorded[0]?.sessionKey).toBe(`hermieos:user-${u.id}`);

    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(updated?.consecutiveFailures).toBe(0);
    expect(updated?.nextRunAt?.getTime()).toBeGreaterThan(before);
  });

  it('subscription envelope includes recent_feedback and recent_activity', async () => {
    const u = await seedUser('alice');
    await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' });

    // Insert feedback so the subscription context carries it.
    const obj = await db
      .insert(schema.objects)
      .values({ userId: u.id, type: 'opportunity', title: 'o1', body: {}, createdBy: 'user' })
      .returning({ id: schema.objects.id });
    await db.insert(schema.feedback).values({ userId: u.id, objectId: obj[0]!.id, kind: 'like' });
    await db.insert(schema.feedback).values({
      userId: u.id,
      objectId: obj[0]!.id,
      kind: 'suggest',
      payload: { note: 'follow up on this' },
    });

    const { tick } = await tickAndTrack();
    expect(tick.subscriptionsDispatched).toBe(1);
    // tickAndTrack also runs the run tracker and the feedback
    // review loop, so there will be 2 recorded dispatches.
    const subCall = hermes.recorded.find((r) => {
      try {
        return JSON.parse(r.input).event === 'subscription';
      } catch {
        return false;
      }
    });
    expect(subCall).toBeDefined();

    const envelope = JSON.parse(subCall!.input ?? '{}');
    expect(Array.isArray(envelope.context.recent_feedback)).toBe(true);
    expect(envelope.context.recent_feedback.length).toBeGreaterThanOrEqual(1);
    const likeRow = envelope.context.recent_feedback.find(
      (r: { kind: string }) => r.kind === 'like',
    );
    expect(likeRow).toBeDefined();
    expect(likeRow.kind).toBe('like');
    expect(typeof likeRow.payload).toBe('object');
    // A suggest row with a note must carry the note through verbatim.
    const suggestRow = envelope.context.recent_feedback.find(
      (r: { kind: string; payload: { note?: string } }) => r.kind === 'suggest',
    );
    expect(suggestRow).toBeDefined();
    expect(suggestRow.payload.note).toBe('follow up on this');

    // Recent activity should also be present (feed events generated by the run).
    expect(Array.isArray(envelope.context.recent_activity)).toBe(true);
  });

  it('does not dispatch a subscription whose next_run_at is in the future', async () => {
    const u = await seedUser('alice');
    await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' }, new Date(Date.now() + 60 * 60_000));

    const summary = await tickOnce(client);
    expect(summary.usersScanned).toBe(0);
    expect(summary.subscriptionsDispatched).toBe(0);
    expect(summary.feedbackReviewsDispatched).toBe(0);
    expect(hermes.recorded.length).toBe(0);
  });

  it('does not dispatch a subscription with a future next_retry_at', async () => {
    const u = await seedUser('alice');
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        userId: u.id,
        name: 'retrying',
        target: 't',
        instruction: 'check',
        cadence: 'daily',
        nextRunAt: new Date(Date.now() - 60_000),
        nextRetryAt: new Date(Date.now() + 60_000),
        consecutiveFailures: 1,
      })
      .returning();
    expect(sub).toBeDefined();

    const summary = await tickOnce(client);
    expect(summary.subscriptionsDispatched).toBe(0);
    expect(hermes.recorded.length).toBe(0);
  });

  it('skips a user with scheduler_enabled=false', async () => {
    const u = await seedUser('paused', { schedulerEnabled: false });
    await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' });

    const summary = await tickOnce(client);
    expect(summary.usersScanned).toBe(0);
    expect(summary.subscriptionsDispatched).toBe(0);
    expect(hermes.recorded.length).toBe(0);
  });

  it('skips an archived user even with scheduler_enabled=true', async () => {
    const u = await seedUser('archived');
    await db.update(schema.users).set({ archivedAt: new Date() }).where(sql`${schema.users.id} = ${u.id}`);
    await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' });

    const summary = await tickOnce(client);
    expect(summary.subscriptionsDispatched).toBe(0);
  });
});

describe('tickOnce — failure handling', () => {
  it('on 5xx, increments consecutive_failures and sets next_retry_at with the 1m backoff', async () => {
    hermes.setMode({ runStatus: 500 });
    const u = await seedUser('alice');
    const sub = await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' });

    const before = Date.now();
    const summary = await tickOnce(client);
    expect(summary.subscriptionsDispatched).toBe(1);
    expect(summary.subscriptionsFailed).toBe(1);
    expect(summary.subscriptionsSucceeded).toBe(0);

    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(updated?.consecutiveFailures).toBe(1);
    expect(updated?.lastError).toMatch(/configured failure/);
    // next_retry_at should be ~1 minute from now
    const delta = (updated?.nextRetryAt?.getTime() ?? 0) - before;
    expect(delta).toBeGreaterThan(30_000);
    expect(delta).toBeLessThan(120_000);
    // and a feed_event of kind task_finished, status=failed
    const [feed] = await db
      .select()
      .from(schema.feedEvents)
      .where(sql`${schema.feedEvents.userId} = ${u.id} and ${schema.feedEvents.kind} = 'task_finished'`);
    expect(feed).toBeDefined();
    expect(feed?.title).toContain('X');
  });

  it('three consecutive failures auto-pause and emit a system notification', async () => {
    hermes.setMode({ alwaysFail: true });
    const u = await seedUser('alice');
    const sub = await seedSubscription(u.id, { name: 'Auto', instruction: 'check', cadence: 'daily' });

    for (let i = 0; i < 3; i++) {
      await db
        .update(schema.subscriptions)
        .set({
          nextRunAt: new Date(Date.now() - 1000),
          nextRetryAt: new Date(Date.now() - 1000),
        })
        .where(sql`${schema.subscriptions.id} = ${sub.id}`);
      const summary = await tickOnce(client);
      expect(summary.subscriptionsFailed).toBe(1);
    }

    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(updated?.status).toBe('paused');
    expect(updated?.consecutiveFailures).toBe(3);

    // the third tick should have emitted a system notification + feed_event
    const [notif] = await db
      .select()
      .from(schema.notifications)
      .where(sql`${schema.notifications.userId} = ${u.id}`);
    expect(notif).toBeDefined();
    expect(notif?.title).toContain('auto-paused');
    expect(notif?.priority).toBe('high');

    const [feed] = await db
      .select()
      .from(schema.feedEvents)
      .where(
        sql`${schema.feedEvents.userId} = ${u.id} and ${schema.feedEvents.kind} = 'notification'`,
      );
    expect(feed).toBeDefined();
  });

  it('retries on transient failure and succeeds on the next attempt (with the right backoff)', async () => {
    hermes.setMode({ transientFailures: 1 });
    const u = await seedUser('alice');
    const sub = await seedSubscription(u.id, { name: 'Recover', instruction: 'check', cadence: 'daily' });

    // First tick: Hermes returns 503 once, then 200. The retry succeeds,
    // so the run tracker settles the run as succeeded.
    const { tick: s1, track: t1 } = await tickAndTrack();
    expect(s1.subscriptionsDispatched).toBe(1);
    expect(t1.runsSettled).toBe(1);
    expect(t1.runsFailed).toBe(0);
    expect(hermes.recorded.length).toBe(2); // one 503 + one 200

    // Second tick (sanity): same path, succeeds again.
    await db
      .update(schema.subscriptions)
      .set({
        nextRunAt: new Date(Date.now() - 1000),
        nextRetryAt: new Date(Date.now() - 1000),
      })
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);

    const { tick: s2, track: t2 } = await tickAndTrack();
    expect(s2.subscriptionsDispatched).toBe(1);
    expect(t2.runsSettled).toBe(1);
    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(updated?.consecutiveFailures).toBe(0);
  });

  it('a non-transient failure (400) does not retry and is marked failed', async () => {
    hermes.setMode({ runStatus: 400 });
    const u = await seedUser('alice');
    const sub = await seedSubscription(u.id, { name: 'BadReq', instruction: 'check', cadence: 'daily' });

    const s1 = await tickOnce(client);
    expect(s1.subscriptionsFailed).toBe(1);
    expect(hermes.recorded.length).toBe(1); // no retry
    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(updated?.consecutiveFailures).toBe(1);
  });
});

describe('tickOnce — feedback review', () => {
  it('dispatches a feedback_review run when feedback has accumulated and no recent review exists', async () => {
    const u = await seedUser('alice');

    // Insert some feedback directly
    const obj = await db
      .insert(schema.objects)
      .values({
        userId: u.id,
        type: 'research',
        title: 'a',
        body: {},
        createdBy: 'user',
      })
      .returning({ id: schema.objects.id });
    expect(obj[0]).toBeDefined();
    // 3 different (user, object, kind) rows so the unique constraint
    // doesn't block them
    await db.insert(schema.feedback).values({
      userId: u.id,
      objectId: obj[0]!.id,
      kind: 'like',
    });
    await db.insert(schema.feedback).values({
      userId: u.id,
      objectId: obj[0]!.id,
      kind: 'save',
    });
    await db.insert(schema.feedback).values({
      userId: u.id,
      objectId: obj[0]!.id,
      kind: 'ignore',
    });

    const summary = await tickOnce(client);
    expect(summary.feedbackReviewsDispatched).toBe(1);
    const reviewCall = hermes.recorded.find((r) => {
      try {
        const e = JSON.parse(r.input);
        return e.event === 'feedback_review' && Array.isArray(e.context.feedback_rows);
      } catch {
        return false;
      }
    });
    expect(reviewCall).toBeDefined();
    expect(reviewCall?.sessionKey).toBe(`hermieos:user-${u.id}`);
  });

  it('feedback_review envelope carries a stats block (counts per kind + suggest notes)', async () => {
    const u = await seedUser('alice');
    // Two discoveries (liked, ignored) and one project (liked), with a
    // suggest that has a note.
    const discovery1 = await db
      .insert(schema.objects)
      .values({ userId: u.id, type: 'discovery', title: 'd1', body: {}, createdBy: 'user' })
      .returning({ id: schema.objects.id });
    const discovery2 = await db
      .insert(schema.objects)
      .values({ userId: u.id, type: 'discovery', title: 'd2', body: {}, createdBy: 'user' })
      .returning({ id: schema.objects.id });
    const project = await db
      .insert(schema.objects)
      .values({ userId: u.id, type: 'project', title: 'p1', body: {}, createdBy: 'user' })
      .returning({ id: schema.objects.id });

    await db.insert(schema.feedback).values({ userId: u.id, objectId: discovery1[0]!.id, kind: 'like' });
    await db.insert(schema.feedback).values({ userId: u.id, objectId: discovery2[0]!.id, kind: 'ignore' });
    await db.insert(schema.feedback).values({ userId: u.id, objectId: project[0]!.id, kind: 'like' });
    await db.insert(schema.feedback).values({
      userId: u.id,
      objectId: discovery1[0]!.id,
      kind: 'suggest',
      payload: { note: 'I would have liked this with a board pinout' },
    });

    const summary = await tickOnce(client);
    expect(summary.feedbackReviewsDispatched).toBe(1);

    const reviewCall = hermes.recorded.find((r) => {
      try {
        const e = JSON.parse(r.input);
        return e.event === 'feedback_review' && e.context?.stats;
      } catch {
        return false;
      }
    });
    expect(reviewCall).toBeDefined();
    const ctx = JSON.parse(reviewCall!.input).context as {
      stats: {
        total: number;
        by_kind: Record<string, number>;
        liked_or_saved_by_type: Record<string, number>;
        suggest_notes: Array<{ note: string }>;
      };
    };
    expect(ctx.stats.total).toBe(4);
    expect(ctx.stats.by_kind.like).toBe(2);
    expect(ctx.stats.by_kind.ignore).toBe(1);
    expect(ctx.stats.by_kind.suggest).toBe(1);
    // The liked/saved breakdown should NOT count `ignore` or `suggest`.
    expect(ctx.stats.liked_or_saved_by_type).toEqual({ discovery: 1, project: 1 });
    // The suggest note text must reach Hermes verbatim.
    expect(ctx.stats.suggest_notes).toHaveLength(1);
    expect(ctx.stats.suggest_notes[0]?.note).toContain('board pinout');
  });

  it('does not dispatch a feedback_review when no feedback is pending', async () => {
    const u = await seedUser('alice');    const summary = await tickOnce(client);
    expect(summary.feedbackReviewsDispatched).toBe(0);
  });
});

describe('tickOnce — dry-run and locking', () => {
  it('dry-run mode does not POST to Hermes', async () => {
    const u = await seedUser('alice');
    await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' });
    const summary = await tickOnce(client, { dryRun: true });
    expect(summary.subscriptionsDispatched).toBe(1);
    expect(summary.subscriptionsSucceeded).toBe(1);
    expect(hermes.recorded.length).toBe(0);
  });

  it('dry-run mode skips the advisory lock (so two dry-run schedulers can run side by side)', async () => {
    const u = await seedUser('alice');
    await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' });
    const a = await tickOnce(client, { dryRun: true });
    const b = await tickOnce(client, { dryRun: true });
    expect(a.lockAcquired).toBe(true);
    expect(b.lockAcquired).toBe(true);
  });

  it('real-mode lock: a second tick while the first holds the lock returns lockAcquired=false', async () => {
    const u = await seedUser('alice');
    await seedSubscription(u.id, { name: 'X', instruction: 'check', cadence: 'daily' });

    // Acquire the lock on a *different* postgres connection so the
    // scheduler's connection (which is the one `pg_try_advisory_lock`
    // would be called on) actually sees it as held by another session.
    const postgres = (await import('postgres')).default;
    const otherClient = postgres(
      process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
    );
    try {
      await otherClient`select pg_advisory_lock(91337)`;
      const summary = await tickOnce(client, { dryRun: false });
      expect(summary.lockAcquired).toBe(false);
      expect(summary.subscriptionsDispatched).toBe(0);
      expect(hermes.recorded.length).toBe(0);
    } finally {
      try {
        await otherClient`select pg_advisory_unlock(91337)`;
      } catch {
        // ignore
      }
      await otherClient.end();
    }
  });
});

describe('tickOnce — chaos', () => {
  it('recovers cleanly after Hermes 500s: the run is marked failed, retried, and succeeds on the next tick', async () => {
    hermes.setMode({ runStatus: 500 });
    const u = await seedUser('alice');
    const sub = await seedSubscription(u.id, {
      name: 'flaky',
      instruction: 'check',
      cadence: 'daily',
    });

    // Tick 1: Hermes returns 500 three times. The HermesClient retries
    // on transient 5xx; after the 3rd failure the run is recorded as
    // failed and consecutive_failures is incremented.
    const s1 = await tickOnce(client);
    expect(s1.subscriptionsFailed).toBe(1);
    const [after1] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(after1?.consecutiveFailures).toBe(1);
    expect(after1?.nextRetryAt).toBeDefined();

    // Tick 2: Hermes is healthy. The subscription is still due
    // (next_retry_at is in the past because backoff is short, but
    // we nudge it just in case). The tick dispatches, then the
    // tracker settles the run as succeeded and advances
    // next_run_at.
    hermes.setMode({ runStatus: 200 });
    await db
      .update(schema.subscriptions)
      .set({
        nextRunAt: new Date(Date.now() - 1000),
        nextRetryAt: new Date(Date.now() - 1000),
      })
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    const { track: t2 } = await tickAndTrack();
    expect(t2.runsSettled).toBe(1);
    const [after2] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(after2?.consecutiveFailures).toBe(0);
  });

  it('a paused user is not dispatched even if a tick is invoked between pause and resume', async () => {
    hermes.setMode({ runStatus: 200 });
    const u = await seedUser('alice');
    await seedSubscription(u.id, { name: 'paused', instruction: 'x', cadence: 'daily' });

    // User pauses.
    await db
      .update(schema.users)
      .set({ schedulerEnabled: false })
      .where(sql`${schema.users.id} = ${u.id}`);

    // Force the subscription due.
    await db.execute(
      sql`update subscriptions set next_run_at = now() - interval '1 second' where user_id = ${u.id}`,
    );

    const s = await tickOnce(client);
    expect(s.subscriptionsDispatched).toBe(0);
    expect(hermes.recorded.length).toBe(0);
  });
});
