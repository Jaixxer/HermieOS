#!/usr/bin/env -S node --import tsx
/**
 * Phase 3 end-to-end script.
 *
 * Boots the real API, then exercises the full user-facing surface:
 *
 *   1. POST /auth/signup with a fresh email; assert user, mcpToken, cookie.
 *   2. GET /me with the cookie; assert user identity.
 *   3. PATCH /me/scheduler {enabled:false}; assert banner state.
 *   4. Insert an object + feed_event directly into the DB; GET /feed returns
 *      the event; second GET is a cache hit (x-cache: hit).
 *   5. GET /objects/:id returns the seeded object.
 *   6. GET /search?q=... finds the object; second call is a cache hit.
 *   7. GET /feed/unread-count returns >= 1; POST /feed/mark-read clears.
 *      Next /feed call is a cache miss.
 *   8. POST /subscriptions creates; GET /subscriptions lists; PATCH updates;
 *      POST /subscriptions/:id/archive archives.
 *   9. POST /me/mcp-token/rotate returns a new mcpToken.
 *  10. Cross-user: alice's GET /feed does not see bob's events.
 *  11. 401: protected routes reject missing cookie.
 *
 * Exit code 0 on success.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/server.js';
import { setDb } from '../src/data/auth.js';
import { createDatabase, schema, closeDatabase } from '@hermieos/db';

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
  await db.execute(sql`delete from feedback where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from object_revisions where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from object_events where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from objects where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from sessions where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from users where email like '%@e2e.local'`);
}

interface CookieJar {
  cookie: string | null;
}

async function call(
  url: string,
  opts: { method?: string; body?: unknown; jar?: CookieJar } = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.jar?.cookie) headers['cookie'] = opts.jar.cookie;
  const res = await app.inject({
    method: (opts.method as 'GET' | 'POST' | 'PATCH' | 'DELETE') ?? 'GET',
    url,
    headers,
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: Record<string, unknown> = {};
  try {
    body = res.json() as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (opts.jar) {
    const setCookie = res.headers['set-cookie'] as string | undefined;
    if (setCookie) {
      opts.jar.cookie = setCookie.split(';')[0] ?? null;
    }
  }
  return { status: res.statusCode, body, headers: res.headers };
}

let app: Awaited<ReturnType<typeof buildApp>>;

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Phase 3 end-to-end: real API + real Postgres.');
  await cleanup();
  app = await buildApp();

  // 1. signup
  const email = `alice-${randomBytes(4).toString('hex')}@e2e.local`;
  const aliceJar: CookieJar = { cookie: null };
  const sign = await call('/auth/signup', {
    method: 'POST',
    body: { email, password: 'correct-horse-battery', displayName: 'Alice' },
    jar: aliceJar,
  });
  if (sign.status !== 200) fail(`signup: ${sign.status} ${JSON.stringify(sign.body)}`);
  if (!(sign.body.user as { id: string }).id) fail('no user id in signup response');
  if (!(sign.body.mcpToken as string).startsWith('mcp_')) fail('mcpToken shape wrong');
  if (!aliceJar.cookie) fail('no session cookie set');
  const aliceId = (sign.body.user as { id: string }).id;
  ok('POST /auth/signup returns user, mcpToken, and sets a session cookie');

  // 2. GET /me
  const me = await call('/me', { jar: aliceJar });
  if (me.status !== 200) fail(`GET /me: ${me.status}`);
  if ((me.body.user as { id: string }).id !== aliceId) fail('GET /me user id mismatch');
  ok('GET /me returns the current user');

  // 3. PATCH /me/scheduler {enabled:false}
  const pause = await call('/me/scheduler', {
    method: 'PATCH',
    body: { enabled: false },
    jar: aliceJar,
  });
  if (pause.status !== 200) fail(`PATCH /me/scheduler: ${pause.status}`);
  if ((pause.body.user as { schedulerEnabled: boolean }).schedulerEnabled !== false) {
    fail('schedulerEnabled not toggled');
  }
  ok('PATCH /me/scheduler toggles the pause flag');

  // restore for later assertions
  await call('/me/scheduler', { method: 'PATCH', body: { enabled: true }, jar: aliceJar });

  // 4. seed an object + feed_event; GET /feed twice
  const [obj] = await db
    .insert(schema.objects)
    .values({
      userId: aliceId,
      type: 'research',
      title: 'e2e-ESP32',
      body: {},
      createdBy: 'user',
    })
    .returning();
  if (!obj) throw new Error('seed object failed');
  await db.insert(schema.feedEvents).values({
    userId: aliceId,
    kind: 'object_created',
    objectId: obj.id,
    title: obj.title,
    payload: { type: obj.type },
  });

  const feed1 = await call('/feed', { jar: aliceJar });
  if (feed1.status !== 200) fail(`GET /feed: ${feed1.status}`);
  if (feed1.headers['x-cache'] !== 'miss') fail(`first /feed should be a miss; got ${feed1.headers['x-cache']}`);
  const events = feed1.body.events as Array<{ kind: string; title: string }>;
  if (!events.some((e) => e.title === 'e2e-ESP32')) fail('seeded event not in feed');
  ok('GET /feed returns seeded events (miss on first call)');

  const feed2 = await call('/feed', { jar: aliceJar });
  if (feed2.headers['x-cache'] !== 'hit') fail(`second /feed should be a hit; got ${feed2.headers['x-cache']}`);
  ok('GET /feed is cached (hit on second call)');

  // 5. GET /objects/:id
  const getObj = await call(`/objects/${obj.id}`, { jar: aliceJar });
  if (getObj.status !== 200) fail(`GET /objects/:id: ${getObj.status}`);
  if ((getObj.body.object as { id: string }).id !== obj.id) fail('object id mismatch');
  ok('GET /objects/:id returns the seeded object');

  // 6. GET /search
  const search1 = await call('/search?q=e2e-ESP32', { jar: aliceJar });
  if (search1.status !== 200) fail(`GET /search: ${search1.status}`);
  if (search1.headers['x-cache'] !== 'miss') fail(`search should be miss; got ${search1.headers['x-cache']}`);
  const hits = search1.body.hits as Array<{ title: string }>;
  if (!hits.some((h) => h.title === 'e2e-ESP32')) fail('search did not find the object');
  const search2 = await call('/search?q=e2e-ESP32', { jar: aliceJar });
  if (search2.headers['x-cache'] !== 'hit') fail(`search should be hit; got ${search2.headers['x-cache']}`);
  ok('GET /search is cached (hit on second call)');

  // 7. unread-count + mark-read invalidates
  const unread = await call('/feed/unread-count', { jar: aliceJar });
  if (unread.status !== 200) fail(`GET /feed/unread-count: ${unread.status}`);
  if ((unread.body.unread as number) < 1) fail('unread count should be >= 1');

  await call('/feed/mark-read', {
    method: 'POST',
    body: { upTo: new Date().toISOString() },
    jar: aliceJar,
  });
  const feed3 = await call('/feed', { jar: aliceJar });
  if (feed3.headers['x-cache'] !== 'miss') fail(`/feed after mark-read should be miss; got ${feed3.headers['x-cache']}`);
  ok('POST /feed/mark-read clears the feed cache');

  // 8. subscription lifecycle
  const sub = await call('/subscriptions', {
    method: 'POST',
    body: { name: 'Watcher', target: 't', instruction: 'check', cadence: 'daily' },
    jar: aliceJar,
  });
  if (sub.status !== 200) fail(`POST /subscriptions: ${sub.status}`);
  const subId = (sub.body.subscription as { id: string }).id;
  const subList = await call('/subscriptions', { jar: aliceJar });
  if ((subList.body.subscriptions as Array<unknown>).length !== 1) fail('subscription list count wrong');
  const subPatch = await call(`/subscriptions/${subId}`, {
    method: 'PATCH',
    body: { name: 'Renamed' },
    jar: aliceJar,
  });
  if ((subPatch.body.subscription as { name: string }).name !== 'Renamed') fail('subscription patch failed');
  const subArch = await call(`/subscriptions/${subId}/archive`, { method: 'POST', jar: aliceJar });
  if ((subArch.body.subscription as { status: string }).status !== 'archived') {
    fail('archive failed');
  }
  ok('subscriptions: create / list / patch / archive');

  // 9. rotate mcp_token
  const oldToken = (sign.body.mcpToken as string);
  const rot = await call('/me/mcp-token/rotate', { method: 'POST', jar: aliceJar });
  if (rot.status !== 200) fail(`rotate: ${rot.status}`);
  const newToken = rot.body.mcpToken as string;
  if (newToken === oldToken) fail('token did not change');
  if (!newToken.startsWith('mcp_')) fail('new token shape wrong');
  ok('POST /me/mcp-token/rotate returns a new token');

  // 10. cross-user
  const bobJar: CookieJar = { cookie: null };
  const bobEmail = `bob-${randomBytes(4).toString('hex')}@e2e.local`;
  const bobSignup = await call('/auth/signup', {
    method: 'POST',
    body: { email: bobEmail, password: 'correct-horse-battery', displayName: 'Bob' },
    jar: bobJar,
  });
  if (bobSignup.status !== 200) fail(`bob signup: ${bobSignup.status}`);
  const bobId = (bobSignup.body.user as { id: string }).id;
  // bob creates an object
  const [bobObj] = await db
    .insert(schema.objects)
    .values({ userId: bobId, type: 'research', title: 'bob-secret', body: {}, createdBy: 'user' })
    .returning();
  if (!bobObj) throw new Error('bob seed object failed');
  await db.insert(schema.feedEvents).values({
    userId: bobId,
    kind: 'object_created',
    objectId: bobObj.id,
    title: bobObj.title,
    payload: { type: bobObj.type },
  });
  // alice fetches her feed — should not see bob's event
  const aliceFeed = await call('/feed', { jar: aliceJar });
  const aliceEvents = aliceFeed.body.events as Array<{ title: string; userId?: string }>;
  if (aliceEvents.some((e) => e.title === 'bob-secret')) {
    fail('alice can see bob\'s events');
  }
  // bob fetches /feed — should see his own event
  const bobFeed = await call('/feed', { jar: bobJar });
  const bobEvents = bobFeed.body.events as Array<{ title: string }>;
  if (!bobEvents.some((e) => e.title === 'bob-secret')) {
    fail('bob cannot see his own event');
  }
  ok('user A cannot see user B\'s events; user B sees their own');

  // 11. 401
  const noAuth = await call('/feed');
  if (noAuth.status !== 401) fail(`expected 401, got ${noAuth.status}`);
  const noAuthMe = await call('/me');
  if (noAuthMe.status !== 401) fail(`GET /me expected 401, got ${noAuthMe.status}`);
  ok('protected routes return 401 without a session cookie');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed, ${failed} failed`);
  await cleanup();
  await app.close();
  await closeDatabase(db);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('e2e failed:', err);
  await cleanup();
  if (app) await app.close();
  await closeDatabase(db);
  process.exit(1);
});
