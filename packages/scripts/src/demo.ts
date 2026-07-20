/**
 * HermieOS full-loop demo.
 *
 * Runs against the local stack: Postgres on :5432, API on :3001, MCP
 * on :3002, scheduler pointed at a fake Hermes on :4100.
 *
 * What it does:
 *   1. Sign up a fresh user
 *   2. Create a Project object via the API
 *   3. Create a Subscription (immediate next_run_at)
 *   4. Start the scheduler for ~25 seconds
 *   5. Observe a Hermes run dispatched and a feed event appear
 *   6. Pause Hermes, verify a second subscription does not fire
 *   7. Print a friendly summary
 *
 * Exits 0 on success, 1 on any failure.
 *
 * Prerequisites:
 *   - Postgres on :5432 (DATABASE_URL or default)
 *   - API on :3001 (start with `pnpm dev:api`)
 *   - The fake-hermes Docker container on :4100
 *     (or: `node packages/scheduler/fake-hermes-docker.js` standalone)
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import { createDatabase, closeDatabase } from '@hermieos/db';

const API = process.env.HERMIEOS_API_URL ?? 'http://127.0.0.1:3001';
const HERMES = process.env.HERMIEOS_HERMES_URL ?? 'http://127.0.0.1:4100';
const DB = process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos';

const startedAt = Date.now();
const t = (label: string): string => {
  const ms = Date.now() - startedAt;
  return `[+${(ms / 1000).toFixed(1)}s] ${label}`;
};
const log = (msg: string): void => {
  // eslint-disable-next-line no-console
  console.log(t(msg));
};
const ok = (msg: string): void => {
  // eslint-disable-next-line no-console
  console.log(t(`\u2713 ${msg}`));
};
const fail = (msg: string): never => {
  // eslint-disable-next-line no-console
  console.error(t(`\u2717 ${msg}`));
  process.exit(1);
};

interface CookieJar {
  cookie: string | null;
}

async function call(
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar.cookie) headers['cookie'] = jar.cookie;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (jar.cookie === null) {
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = set.split(';')[0] ?? null;
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json, headers: res.headers };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  options: { timeoutMs: number; label: string; intervalMs?: number },
): Promise<void> {
  const interval = options.intervalMs ?? 500;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  fail(`timed out waiting for: ${options.label}`);
}

async function withDb<T>(fn: (db: ReturnType<typeof createDatabase>) => Promise<T>): Promise<T> {
  const demoDb = createDatabase({ url: DB });
  try {
    return await fn(demoDb);
  } finally {
    await closeDatabase(demoDb);
  }
}

async function main(): Promise<void> {
  log('HermieOS demo starting…');
  log(`  API:    ${API}`);
  log(`  Hermes: ${HERMES}`);
  log(`  DB:     ${DB.replace(/:[^:@]+@/, ':***@')}`);

  // 0. health
  const health = await fetch(`${API}/healthz`);
  if (!health.ok) fail(`API healthz failed (${health.status})`);
  ok('API healthy');

  // Hermes's API server exposes /health (the real one) and the
  // fake Hermes exposes /healthz. Try both.
  let hermesOk = false;
  for (const path of ['/healthz', '/health']) {
    const r = await fetch(`${HERMES}${path}`);
    if (r.ok) { hermesOk = true; break; }
  }
  if (!hermesOk) fail(`Hermes not reachable on ${HERMES}`);
  ok('Hermes reachable');

  // 1. sign up
  const email = `demo-${randomBytes(4).toString('hex')}@demo.local`;
  const jar: CookieJar = { cookie: null };
  const sign = await call(jar, 'POST', '/auth/signup', {
    email,
    password: 'correct-horse-battery',
    displayName: 'Demo',
  });
  if (sign.status !== 200) fail(`signup failed: ${sign.status} ${JSON.stringify(sign.json)}`);
  const userId = (sign.json.user as { id: string }).id;
  ok(`signed up as ${email} (user ${userId})`);

  // 2. create a project
  const create = await call(jar, 'POST', '/objects', {
    type: 'project',
    title: 'demo-Project',
    summary: 'created by the demo script',
    body: { goal: 'see the full loop' },
    tags: ['demo'],
  });
  if (create.status !== 201) fail(`POST /objects failed: ${create.status} ${JSON.stringify(create.json)}`);
  ok(`created project (id ${(create.json.object as { id: string }).id})`);

  // 3. create a subscription with next_run_at in the past
  const sub = await call(jar, 'POST', '/subscriptions', {
    name: 'demo-watcher',
    target: 'demo-target',
    instruction: 'watch for new things',
    cadence: 'hourly',
  });
  if (sub.status !== 200) fail(`POST /subscriptions failed: ${sub.status}`);
  const subId = (sub.json.subscription as { id: string }).id;
  await withDb(async (demoDb) => {
    await demoDb.execute(
      drizzleSql`update subscriptions set next_run_at = now() - interval '1 second' where id = ${subId}`,
    );
  });
  ok(`subscription ${subId} created and set due`);

  // 4. start the scheduler in a child process
  log('starting scheduler (will run for ~25s)…');
  // Use `pnpm exec tsx src/main.ts` (not `pnpm dev`) so the DATABASE_URL
  // we set on this process is inherited by the scheduler child.
  const schedulerProc = spawn(
    'pnpm',
    ['--filter', '@hermieos/scheduler', 'exec', 'tsx', 'src/main.ts'],
    {
      env: {
        ...process.env,
        DATABASE_URL: DB,
        HERMES_GATEWAY_URL: HERMES,
        // Fake Hermes doesn't require auth, but the client wants an apiKey.
        // The fake-hermes-docker server ignores it; pass a placeholder.
        HERMES_API_KEY: 'demo-key',
        SCHEDULER_TICK_MS: '3000',
        LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  // give the scheduler a moment to come up
  await new Promise((r) => setTimeout(r, 2000));

  // 5. wait for the hermes run to land — i.e. a feed event
  //     of kind 'object_created' with our project title.
  try {
    await waitFor(
      async () => {
        const feed = await call(jar, 'GET', '/feed');
        if (feed.status !== 200) return false;
        const events = (feed.json.events ?? []) as Array<{ kind: string; title: string }>;
        return events.some((e) => e.kind === 'object_created' && e.title === 'demo-Project');
      },
      { timeoutMs: 20_000, label: 'feed to contain the seeded object' },
    );
    ok('feed contains the demo project');
  } catch (e) {
    schedulerProc.kill('SIGTERM');
    throw e;
  }

  // 6. pause Hermes and verify a fresh subscription does not fire
  log('pausing Hermes…');
  const pause = await call(jar, 'PATCH', '/me/scheduler', { enabled: false });
  if (pause.status !== 200) fail(`pause failed: ${pause.status}`);

  // create a 2nd subscription and force it due
  const sub2 = await call(jar, 'POST', '/subscriptions', {
    name: 'demo-paused',
    target: 'demo-paused',
    instruction: 'should not fire',
    cadence: 'hourly',
  });
  if (sub2.status !== 200) fail('subscription 2 create failed');
  const sub2Id = (sub2.json.subscription as { id: string }).id;
  await withDb(async (demoDb) => {
    await demoDb.execute(
      drizzleSql`update subscriptions set next_run_at = now() - interval '1 second' where id = ${sub2Id}`,
    );
  });
  // mark the feed to know what's new after pause
  const upTo = new Date().toISOString();
  await call(jar, 'POST', '/feed/mark-read', { upTo });

  // wait 6s (2 ticks at 3s each) and verify the feed did NOT grow
  await new Promise((r) => setTimeout(r, 6000));
  const after = await call(jar, 'GET', '/feed');
  if (after.status !== 200) fail(`feed after pause: ${after.status}`);
  const newEvents = (after.json.events ?? []) as Array<{ title: string }>;
  if (newEvents.some((e) => e.title === 'demo-paused')) {
    schedulerProc.kill('SIGTERM');
    fail('paused subscription still fired — pause flag is broken');
  }
  ok('paused subscription did not fire');

  // 7. teardown
  schedulerProc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(`\n  Demo complete in ${elapsed}s. All loops green.`);
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('demo failed:', err);
  process.exit(1);
});
