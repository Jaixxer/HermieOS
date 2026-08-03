/**
 * Run tracker unit tests.
 *
 * Drives trackRunsOnce with a fake Hermes that returns specific
 * statuses per run, and asserts the local hermes_runs table is
 * updated correctly.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { HermesClient } from '@hermieos/gateway';
import { tickOnce } from './tick.js';
import { trackRunsOnce, findInFlightRuns } from './run-tracker.js';
import { setDb } from './db.js';
import { makeFakeHermes, type FakeHermes } from '@hermieos/gateway/src/test-helpers/fake-hermes.js';

let db: Database;
let hermes: FakeHermes;
let client: HermesClient;

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  });
  setDb(db);
  hermes = await makeFakeHermes();
  client = new HermesClient({ baseUrl: hermes.url, apiKey: 'test-key', maxRetries: 0 });
});
afterAll(async () => {
  await hermes.close();
  await closeDatabase(db);
});

beforeEach(async () => {
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@tracker-test.local')`);
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email like '%@tracker-test.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@tracker-test.local')`);
  await db.execute(sql`delete from users where email like '%@tracker-test.local'`);
  await db.$client`select pg_advisory_unlock_all()`;
  hermes.setMode({});
});

async function seedUser(label: string): Promise<{ id: string }> {
  const email = `${label}-${randomBytes(4).toString('hex')}@tracker-test.local`;
  const [row] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: 'tracker',
      displayName: label,
      mcpToken: `mcp_${randomBytes(8).toString('hex')}`,
      schedulerEnabled: true,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('seed user failed');
  return { id: row.id };
}

async function seedSubscription(userId: string, nextRunAt: Date = new Date(Date.now() - 60_000)): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      userId,
      name: 'X',
      target: 't',
      instruction: 'check',
      cadence: 'daily',
      nextRunAt,
    })
    .returning({ id: schema.subscriptions.id });
  if (!row) throw new Error('seed sub failed');
  return { id: row.id };
}

describe('trackRunsOnce', () => {
  it('settles a running run as succeeded and advances the subscription', async () => {
    hermes.setMode({ getRunStatus: 'succeeded' });
    const u = await seedUser('alice');
    const sub = await seedSubscription(u.id);
    const before = Date.now();
    await tickOnce(client); // dispatches, leaves the run as 'running'
    const summary = await trackRunsOnce(client);
    expect(summary.runsSettled).toBe(1);
    expect(summary.runsFailed).toBe(0);

    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(updated?.consecutiveFailures).toBe(0);
    expect(updated?.nextRunAt?.getTime()).toBeGreaterThan(before);
  });

  it('settles a running run as failed, applies backoff, and emits a feed event', async () => {
    hermes.setMode({ getRunStatus: 'failed' });
    const u = await seedUser('alice');
    const sub = await seedSubscription(u.id);
    await tickOnce(client);
    const summary = await trackRunsOnce(client);
    expect(summary.runsFailed).toBe(1);

    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(updated?.consecutiveFailures).toBe(1);
    expect(updated?.nextRetryAt).toBeDefined();
    expect(updated?.lastError).toBe('failed');

    const [feed] = await db
      .select()
      .from(schema.feedEvents)
      .where(sql`${schema.feedEvents.userId} = ${u.id} and ${schema.feedEvents.kind} = 'task_finished'`);
    expect(feed).toBeDefined();
    expect(feed?.title).toBe('Run failed');
  });

  it('force-stops a run that has exceeded the deadline and marks it cancelled', async () => {
    hermes.setMode({ getRunStatus: 'running' });
    const u = await seedUser('alice');
    const sub = await seedSubscription(u.id);
    await tickOnce(client);

    // backdate started_at so the run looks like it has been running
    // for longer than the deadline
    await db.execute(sql`update hermes_runs set started_at = now() - interval '10 minutes' where user_id = ${u.id}`);

    const summary = await trackRunsOnce(client, { deadlineMs: 5_000 });
    expect(summary.runsCancelled).toBe(1);
    expect(summary.runsStopForced).toBe(1);

    // subscription: a forced cancel is a failure for retry purposes
    const [updated] = await db
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.id} = ${sub.id}`);
    expect(updated?.consecutiveFailures).toBe(1);
  });

  it('leaves an in-progress run alone (no settlement on a non-terminal status)', async () => {
    hermes.setMode({ getRunStatus: 'running' });
    const u = await seedUser('alice');
    await seedSubscription(u.id);
    await tickOnce(client);
    const summary = await trackRunsOnce(client, { deadlineMs: 5 * 60_000 });
    expect(summary.runsSettled).toBe(0);
    expect(summary.runsFailed).toBe(0);
    expect(summary.runsCancelled).toBe(0);

    // the run is still in 'running'
    const inFlight = await findInFlightRuns(db);
    expect(inFlight.length).toBe(1);
  });

  it('does not re-settle a run that is already terminal', async () => {
    hermes.setMode({ getRunStatus: 'succeeded' });
    const u = await seedUser('alice');
    await seedSubscription(u.id);
    await tickOnce(client);
    const first = await trackRunsOnce(client);
    expect(first.runsSettled).toBe(1);

    // second pass: nothing to do
    const second = await trackRunsOnce(client);
    expect(second.runsSettled).toBe(0);
    expect(second.runsScanned).toBe(0);
  });

  it('emits a feed event for every successful scout run, using the agent summary as the body', async () => {
    hermes.setMode({ getRunStatus: 'succeeded', getRunOutput: 'Watched arxiv:cs.AI. No new findings.' });
    const u = await seedUser('alice');
    const [sub] = await db
      .insert(schema.subscriptions)
      .values({
        userId: u.id,
        name: 'Paper Scout',
        target: 'arxiv:cs.AI',
        instruction: 'find me a paper',
        cadence: 'daily',
        nextRunAt: new Date(Date.now() - 60_000),
      })
      .returning();
    if (!sub) throw new Error('seed sub failed');

    await tickOnce(client);
    const summary = await trackRunsOnce(client);
    expect(summary.runsSettled).toBe(1);

    const [feed] = await db
      .select()
      .from(schema.feedEvents)
      .where(sql`${schema.feedEvents.userId} = ${u.id} and ${schema.feedEvents.kind} = 'task_finished'`);
    expect(feed).toBeDefined();
    expect(feed?.title).toBe('Scout "Paper Scout" ran');
    expect(feed?.body).toBe('Watched arxiv:cs.AI. No new findings.');
    expect((feed?.payload as Record<string, unknown> | null)?.status).toBe('succeeded');
    expect((feed?.payload as Record<string, unknown> | null)?.subscriptionId).toBe(sub.id);
  });

  it('emits a fallback feed event when a successful scout run returns no summary', async () => {
    hermes.setMode({ getRunStatus: 'succeeded', getRunOutput: '' });
    const u = await seedUser('alice');
    await db.insert(schema.subscriptions).values({
      userId: u.id,
      name: 'Quiet Scout',
      target: 'hn:frontpage',
      instruction: 'watch',
      cadence: 'daily',
      nextRunAt: new Date(Date.now() - 60_000),
    });
    await tickOnce(client);
    await trackRunsOnce(client);

    const [feed] = await db
      .select()
      .from(schema.feedEvents)
      .where(sql`${schema.feedEvents.userId} = ${u.id} and ${schema.feedEvents.kind} = 'task_finished'`);
    expect(feed?.title).toBe('Scout "Quiet Scout" ran');
    expect(feed?.body).toBe('Watched hn:frontpage. Run completed with no summary.');
  });

  it('does not emit a scout feed event for a successful ad_hoc run', async () => {
    hermes.setMode({ getRunStatus: 'succeeded' });
    const u = await seedUser('alice');
    await db.insert(schema.hermesRuns).values({
      id: randomUUID(),
      userId: u.id,
      kind: 'ad_hoc',
      subscriptionId: null,
      prompt: '{"event":"research"}',
      hermesRunId: 'hermes-adhoc-1',
      status: 'running',
    });
    await trackRunsOnce(client);

    const feeds = await db
      .select()
      .from(schema.feedEvents)
      .where(sql`${schema.feedEvents.userId} = ${u.id}`);
    expect(feeds.filter((f) => f.kind === 'task_finished')).toHaveLength(0);
  });
});
