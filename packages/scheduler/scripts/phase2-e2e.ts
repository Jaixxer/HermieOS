/**
 * Phase 2 end-to-end script.
 *
 * Boots a fake Hermes server, points a real scheduler at it, and exercises
 * the full subscription lifecycle:
 *
 *   1. Single tick on a happy-path subscription: Hermes 200, run
 *      marked succeeded, next_run_at advanced, no feed_event.
 *   2. Three consecutive failing ticks: consecutive_failures goes 1, 2, 3;
 *      on the third, the subscription auto-pauses, a system notification
 *      is emitted, a feed_event of kind 'task_finished' is written.
 *   3. Pause-Hermes flag: subscription whose user is paused is skipped.
 *   4. Feedback review: with feedback present, a feedback_review run
 *      is dispatched to Hermes.
 *   5. Lock: a second tick while the first holds the advisory lock
 *      sees lockAcquired=false.
 *   6. Retry: one transient 503 then a 200, the run still succeeds.
 *
 * Exit code 0 on success.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, closeDatabase, schema } from '@hermieos/db';
import { HermesClient } from '../src/hermes-client.js';
import { tickOnce } from '../src/tick.js';
import { setDb } from '../src/db.js';
import { makeFakeHermes, type FakeHermes } from '../src/test-helpers/fake-hermes.js';

const URL = process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos';
const db = createDatabase({ url: URL });
setDb(db);

let passed = 0;
let failed = 0;
const fail = (msg: string): never => {
  // eslint-disable-next-line no-console
  console.error(`\u2717 ${msg}`);
  failed++;
  process.exit(1);
};
const ok = (msg: string): void => {
  // eslint-disable-next-line no-console
  console.log(`\u2713 ${msg}`);
  passed++;
};

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from notifications where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from feedback where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from objects where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from users where email like '%@e2e.local'`);
  await db.$client`select pg_advisory_unlock_all()`;
}

async function seedUser(label: string, opts: { schedulerEnabled?: boolean } = {}): Promise<{ id: string }> {
  const email = `${label}-${randomBytes(4).toString('hex')}@e2e.local`;
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
  if (!row) throw new Error('seed user failed');
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
      target: 't',
      instruction: opts.instruction,
      cadence: opts.cadence,
      nextRunAt,
    })
    .returning({ id: schema.subscriptions.id });
  if (!row) throw new Error('seed sub failed');
  return { id: row.id };
}

let hermes: FakeHermes;
let client: HermesClient;

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Phase 2 end-to-end: real scheduler + fake Hermes + real Postgres.');
  await cleanup();
  hermes = await makeFakeHermes();
  client = new HermesClient({ baseUrl: hermes.url, apiKey: 'test-key' });

  // ----- 1. happy path: one tick, one dispatch, success -----
  hermes.setMode({});
  hermes.recorded.length = 0;
  const u1 = await seedUser('alice');
  const sub1 = await seedSubscription(u1.id, { name: 'Watcher', instruction: 'check feeds', cadence: 'daily' });
  const s1 = await tickOnce(client);
  if (s1.subscriptionsDispatched !== 1 || s1.subscriptionsSucceeded !== 1) {
    fail(`happy-path tick: ${JSON.stringify(s1)}`);
  }
  if (hermes.recorded.length !== 1) {
    fail(`expected 1 POST /v1/runs, got ${hermes.recorded.length}`);
  }
  const [sub1After] = await db
    .select()
    .from(schema.subscriptions)
    .where(sql`${schema.subscriptions.id} = ${sub1.id}`);
  if (sub1After?.consecutiveFailures !== 0) fail('consecutive_failures should be 0');
  const nextRunAtMs = sub1After?.nextRunAt instanceof Date ? sub1After.nextRunAt.getTime() : 0;
  if (nextRunAtMs <= Date.now()) {
    // eslint-disable-next-line no-console
    console.error('sub1After keys', Object.keys(sub1After ?? {}), 'nextRunAt', sub1After?.nextRunAt, 'typeof', typeof sub1After?.nextRunAt, 'now', new Date());
    fail('next_run_at should be in the future after success');
  }
  ok('happy path: 1 tick, 1 dispatch, 1 success, next_run_at advanced');

  // ----- 2. three consecutive failures: auto-pause + system notify -----
  await cleanup();
  hermes.setMode({});
  hermes.recorded.length = 0;
  hermes.setMode({ alwaysFail: true });
  const u2 = await seedUser('bob');
  const sub2 = await seedSubscription(u2.id, { name: 'Brittle', instruction: 'check the API', cadence: 'daily' });
  for (let i = 0; i < 3; i++) {
    await db
      .update(schema.subscriptions)
      .set({ nextRunAt: new Date(Date.now() - 1000), nextRetryAt: new Date(Date.now() - 1000) })
      .where(sql`${schema.subscriptions.id} = ${sub2.id}`);
    const s = await tickOnce(client);
    if (s.subscriptionsFailed !== 1) fail(`tick ${i} failed count: ${JSON.stringify(s)}`);
  }
  const [sub2After] = await db
    .select()
    .from(schema.subscriptions)
    .where(sql`${schema.subscriptions.id} = ${sub2.id}`);
  if (sub2After?.status !== 'paused') fail(`expected paused, got ${sub2After?.status}`);
  if (sub2After?.consecutiveFailures !== 3) fail(`expected 3, got ${sub2After?.consecutiveFailures}`);
  const [notif] = await db
    .select()
    .from(schema.notifications)
    .where(sql`${schema.notifications.userId} = ${u2.id}`);
  if (!notif) fail('expected a system notification');
  if (notif?.priority !== 'high') fail(`expected high-priority notification`);
  const feedEvents = await db
    .select()
    .from(schema.feedEvents)
    .where(sql`${schema.feedEvents.userId} = ${u2.id} and ${schema.feedEvents.kind} = 'task_finished'`);
  if (feedEvents.length !== 3) fail(`expected 3 task_finished feed events, got ${feedEvents.length}`);
  ok('three failures: auto-paused, system notification emitted, 3 feed events written');

  // ----- 3. pause flag: a paused user is skipped -----
  await cleanup();
  hermes.setMode({});
  hermes.recorded.length = 0;
  const u3 = await seedUser('paula', { schedulerEnabled: false });
  const sub3 = await seedSubscription(u3.id, { name: 'Paused', instruction: 'check', cadence: 'daily' });
  const s3 = await tickOnce(client);
  if (s3.subscriptionsDispatched !== 0) fail(`paused user tick: ${JSON.stringify(s3)}`);
  if (hermes.recorded.length !== 0) fail('paused user should not have been dispatched');
  ok('pause flag: paused user is skipped');

  // ----- 4. feedback review -----
  await cleanup();
  hermes.setMode({});
  hermes.recorded.length = 0;
  const u4 = await seedUser('frank');
  const obj = await db
    .insert(schema.objects)
    .values({ userId: u4.id, type: 'research', title: 'fb-obj', body: {}, createdBy: 'user' })
    .returning({ id: schema.objects.id });
  if (!obj[0]) throw new Error('seed object failed');
  for (const kind of ['like', 'save', 'ignore'] as const) {
    await db.insert(schema.feedback).values({ userId: u4.id, objectId: obj[0]!.id, kind });
  }
  const s4 = await tickOnce(client);
  if (s4.feedbackReviewsDispatched !== 1) fail(`feedback review: ${JSON.stringify(s4)}`);
  const reviewCall = hermes.recorded.find((r) => r.input.includes('[kind=feedback_review]'));
  if (!reviewCall) fail('expected a feedback_review dispatch');
  if (!reviewCall?.input.includes('3 feedback')) fail('expected 3 feedback in the prompt');
  ok('feedback review: dispatched when 3 feedback signals pending');

  // ----- 5. lock: second tick while the first holds the lock -----
  await cleanup();
  hermes.setMode({});
  hermes.recorded.length = 0;
  const u5 = await seedUser('locky');
  await seedSubscription(u5.id, { name: 'X', instruction: 'check', cadence: 'daily' });
  const postgres = (await import('postgres')).default(URL);
  try {
    await postgres`select pg_advisory_lock(91337)`;
    const s5 = await tickOnce(client, { dryRun: false });
    if (s5.lockAcquired) fail(`expected lockAcquired=false, got ${JSON.stringify(s5)}`);
    if (s5.subscriptionsDispatched !== 0) fail(`expected 0 dispatches, got ${JSON.stringify(s5)}`);
    ok('advisory lock: second tick while first holds the lock is a no-op');
  } finally {
    try {
      await postgres`select pg_advisory_unlock(91337)`;
    } catch {
      // ignore
    }
    await postgres.end();
  }

  // ----- 6. retry: one transient 503 then 200 -----
  await cleanup();
  hermes.setMode({});
  hermes.recorded.length = 0;
  hermes.setMode({ transientFailures: 1 });
  const u6 = await seedUser('retry');
  const sub6 = await seedSubscription(u6.id, { name: 'Recovers', instruction: 'check', cadence: 'daily' });
  const s6 = await tickOnce(client);
  if (s6.subscriptionsSucceeded !== 1) fail(`retry: ${JSON.stringify(s6)}`);
  if (hermes.recorded.length !== 2) fail(`expected 2 calls (503 + 200), got ${hermes.recorded.length}`);
  const [sub6After] = await db
    .select()
    .from(schema.subscriptions)
    .where(sql`${schema.subscriptions.id} = ${sub6.id}`);
  if (sub6After?.consecutiveFailures !== 0) fail(`consecutive_failures should be 0, got ${sub6After?.consecutiveFailures}`);
  ok('transient retry: one 503 + retry 200 -> run succeeded, no failure recorded');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed, ${failed} failed`);
  await hermes.close();
  await cleanup();
  await closeDatabase(db);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('e2e failed:', err);
  if (hermes) await hermes.close();
  await cleanup();
  await closeDatabase(db);
  process.exit(1);
});
