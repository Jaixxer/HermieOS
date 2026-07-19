#!/usr/bin/env -S node --import tsx
/**
 * Phase 1 exit-criterion script.
 *
 * Boots a real MCP server in-process, signs up a user via direct SQL (we
 * don't have an HTTP signup endpoint yet — that's Phase 3), mints a token,
 * and exercises the full Phase 1 tool flow:
 *
 *   - create_object (writes revision #1, emits a feed_event)
 *   - update_object (writes revision #2)
 *   - revert_object (writes revision #3 with old content)
 *   - search_objects (FTS finds the new object)
 *   - link_objects (upsert on (from, to, kind))
 *   - create_subscription (next_run_at computed from cadence)
 *   - record_feedback (like + ignore + suggest)
 *   - get_recent_activity (feed includes our events)
 *   - get_object_timeline (created/updated/reverted visible)
 *   - notify_user (5 calls succeed, 6th rejected with rate-limit error)
 *   - get_recent_runs (read-only introspection)
 *   - auth-scope: a second user cannot see this user's data
 *
 * Exit code 0 means every step passed. Print a green check on each line.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, closeDatabase, schema } from '@hermieos/db';
import { buildMcpApp } from '../src/server.js';
import { ToolRegistry } from '../src/registry.js';
import { registerObjectTools } from '../src/tools/objects.js';
import { registerRelationshipAndSubscriptionTools } from '../src/tools/misc.js';
import { registerNotifyTool } from '../src/tools/notify.js';
import { registerRunsTool } from '../src/tools/runs.js';

const URL = process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos';
const db = createDatabase({ url: URL });

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
  await db.execute(sql`delete from object_relationships where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from feedback where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from notifications where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from object_revisions where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from object_events where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from objects where user_id in (select id from users where email like '%@e2e.local')`);
  await db.execute(sql`delete from users where email like '%@e2e.local'`);
}

async function seedUser(label: string): Promise<{ id: string; token: string }> {
  const token = `tok_${label}_${randomBytes(8).toString('hex')}`;
  const email = `${label}-${randomBytes(4).toString('hex')}@e2e.local`;
  const [row] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'x', displayName: label, mcpToken: token })
    .returning({ id: schema.users.id, token: schema.users.mcpToken });
  if (!row) throw new Error('seed failed');
  return { id: row.id, token: row.token };
}

const registry = new ToolRegistry();
registerObjectTools(registry);
registerRelationshipAndSubscriptionTools(registry);
registerNotifyTool(registry);
registerRunsTool(registry);
const app = buildMcpApp(registry);

interface ToolResult<T> {
  isError: boolean;
  text: string;
  parsed: T;
}

async function callTool<T = unknown>(
  sessionId: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult<T>> {
  const res = await app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomBytes(4).toString('hex'),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  if (res.status !== 200) throw new Error(`mcp call failed: ${res.status}`);
  const body = await res.text();
  const m = /data: (\{.*\})/s.exec(body);
  if (!m || !m[1]) throw new Error(`no data line: ${body}`);
  const parsed = JSON.parse(m[1]) as { result?: { isError?: boolean; content?: Array<{ type: string; text: string }> } };
  const content = parsed.result?.content?.[0];
  if (!content || content.type !== 'text') {
    return { isError: !!parsed.result?.isError, text: '', parsed: null as T };
  }
  let value: T;
  try {
    value = JSON.parse(content.text) as T;
  } catch {
    value = content.text as unknown as T;
  }
  return { isError: !!parsed.result?.isError, text: content.text, parsed: value };
}

async function initSession(token: string): Promise<string> {
  const res = await app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '0' },
        },
      }),
    }),
  );
  if (res.status !== 200) throw new Error(`init failed: ${res.status}`);
  const sid = res.headers.get('mcp-session-id');
  if (!sid) throw new Error('no session id');
  return sid;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Phase 1 end-to-end: real MCP transport, real Postgres.');
  await cleanup();

  const alice = await seedUser('alice');
  const bob = await seedUser('bob');
  ok('seeded two users with mcp tokens');

  const aliceSession = await initSession(alice.token);
  const bobSession = await initSession(bob.token);
  ok('initialized two MCP sessions');

  // 1. create_object
  const c1 = await callTool<{ object: { id: string; revision: number } }>(
    aliceSession,
    alice.token,
    'create_object',
    { type: 'research', title: 'ESP32 power optimization', source: 'e2e' },
  );
  if (c1.isError) fail(`create_object: ${c1.text}`);
  if (c1.parsed.object.revision !== 1) fail(`expected revision 1, got ${c1.parsed.object.revision}`);
  ok('create_object wrote revision 1');

  // 2. update_object twice
  const u1 = await callTool<{ revisionCreated: number }>(aliceSession, alice.token, 'update_object', {
    id: c1.parsed.object.id,
    title: 'ESP32 power optimization v2',
    source: 'e2e',
  });
  if (u1.parsed.revisionCreated !== 2) fail(`expected revision 2, got ${u1.parsed.revisionCreated}`);
  ok('update_object wrote revision 2');

  // 3. revert_object
  const r1 = await callTool<{ object: { revision: number; title: string } }>(
    aliceSession,
    alice.token,
    'revert_object',
    { id: c1.parsed.object.id, revision: 1, source: 'e2e' },
  );
  if (r1.parsed.object.title !== 'ESP32 power optimization') fail('revert did not restore title');
  if (r1.parsed.object.revision !== 3) fail('revert did not create a new revision');
  ok('revert_object wrote revision 3 with original content');

  // 4. search_objects
  const s1 = await callTool<{ hits: Array<{ title: string; rank: number; snippet: string }> }>(
    aliceSession,
    alice.token,
    'search_objects',
    { query: 'ESP32', limit: 5 },
  );
  if (s1.parsed.hits.length === 0) fail('search found nothing');
  if (!s1.parsed.hits[0]?.title.includes('ESP32')) fail('search returned wrong object');
  ok('search_objects found the new research with a snippet');

  // 5. link_objects
  const c2 = await callTool<{ object: { id: string } }>(aliceSession, alice.token, 'create_object', {
    type: 'discovery',
    title: 'ESP32 deep sleep current',
    source: 'e2e',
  });
  const l1 = await callTool<{ relationship: { confidence: number } }>(
    aliceSession,
    alice.token,
    'link_objects',
    {
      fromId: c1.parsed.object.id,
      toId: c2.parsed.object.id,
      kind: 'related_to',
      confidence: 0.9,
      reason: 'deep dive into the topic',
      source: 'e2e',
    },
  );
  if (l1.parsed.relationship.confidence !== 0.9) fail('link confidence not stored');
  ok('link_objects created edge with confidence 0.9');

  // 6. create_subscription
  const sub = await callTool<{ subscription: { id: string; nextRunAt: string } }>(
    aliceSession,
    alice.token,
    'create_subscription',
    {
      name: 'Watch ESP32',
      target: 'github.com/espressif',
      instruction: 'check for new repos',
      cadence: 'daily',
      source: 'e2e',
    },
  );
  if (new Date(sub.parsed.subscription.nextRunAt).getTime() <= Date.now()) {
    fail('subscription nextRunAt is not in the future');
  }
  ok('create_subscription computed nextRunAt');

  // 7. record_feedback (like, ignore, suggest)
  for (const kind of ['like', 'ignore', 'suggest'] as const) {
    const f = await callTool<{ feedback: { kind: string } }>(aliceSession, alice.token, 'record_feedback', {
      objectId: c1.parsed.object.id,
      kind,
      payload: kind === 'suggest' ? { text: 'add ESP32-S3 notes' } : {},
      source: 'e2e',
    });
    if (f.isError) fail(`record_feedback ${kind}: ${f.text}`);
  }
  ok('record_feedback for like/ignore/suggest');

  // 8. notify_user rate limit (do this BEFORE get_recent_activity so the
  // feed actually has notification events to surface)
  let n5ok = true;
  for (let i = 0; i < 5; i++) {
    const n = await callTool<{ notification: { id: string } }>(aliceSession, alice.token, 'notify_user', {
      title: `n${i}`,
      message: 'm',
      priority: 'normal',
      source: 'e2e',
    });
    if (n.isError) {
      n5ok = false;
      break;
    }
  }
  if (!n5ok) fail('one of the first 5 notify_user calls failed');
  ok('first 5 notify_user calls succeed');

  const sixth = await callTool(aliceSession, alice.token, 'notify_user', {
    title: 'too many',
    message: 'm',
    priority: 'normal',
    source: 'e2e',
  });
  if (!sixth.isError) fail('6th notify_user should have been rate-limited');
  if (!sixth.text.toLowerCase().includes('rate limit')) fail('rate-limit error message missing');
  ok('6th notify_user rejected with rate-limit error');

  // 9. get_recent_activity (after notify_user so notifications are in the feed)
  const feed = await callTool<{ events: Array<{ kind: string }> }>(
    aliceSession,
    alice.token,
    'get_recent_activity',
    { limit: 50 },
  );
  const kinds = new Set(feed.parsed.events.map((e) => e.kind));
  if (!kinds.has('object_created')) fail('feed missing object_created');
  if (!kinds.has('notification')) fail('feed missing notification');
  ok('get_recent_activity includes create + notification events');

  // 10. get_object_timeline
  const tl = await callTool<{ events: Array<{ kind: string }> }>(
    aliceSession,
    alice.token,
    'get_object_timeline',
    { id: c1.parsed.object.id, limit: 20 },
  );
  const tlKinds = tl.parsed.events.map((e) => e.kind);
  if (!tlKinds.includes('created')) fail('timeline missing created');
  if (!tlKinds.includes('reverted_to_revision')) fail('timeline missing reverted_to_revision');
  ok('get_object_timeline shows created + reverted');

  // 11. get_recent_runs (we manually inserted runs in tests; here we just
  // verify the tool returns 0 results cleanly).
  const runs = await callTool<{ runs: unknown[] }>(aliceSession, alice.token, 'get_recent_runs', { limit: 10 });
  if (!Array.isArray(runs.parsed.runs)) fail('get_recent_runs did not return an array');
  ok('get_recent_runs returns an array');

  // 12. auth scope: bob cannot read alice's objects
  const bobGet = await callTool<{ object: unknown }>(bobSession, bob.token, 'get_object', {
    id: c1.parsed.object.id,
  });
  if (bobGet.parsed.object !== null) fail('bob was able to read alice\'s object');
  ok('user B cannot read user A\'s object');

  // 13. auth scope: bob's search does not return alice's objects
  const bobSearch = await callTool<{ hits: unknown[] }>(bobSession, bob.token, 'search_objects', {
    query: 'ESP32',
    limit: 10,
  });
  if (bobSearch.parsed.hits.length !== 0) fail('bob found alice\'s objects in search');
  ok('user B cannot find user A\'s objects in search');

  // 14. unauthenticated request returns 401
  const noAuth = await app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );
  if (noAuth.status !== 401) fail(`expected 401, got ${noAuth.status}`);
  ok('unauthenticated /mcp POST returns 401');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed, ${failed} failed`);

  await cleanup();
  await closeDatabase(db);

  // Force exit — the in-process MCP server keeps a 5-min prune interval
  // alive even after unref, which holds the event loop open.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('e2e failed:', err);
  process.exit(1);
});
