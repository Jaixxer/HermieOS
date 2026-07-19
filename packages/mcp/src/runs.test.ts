import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { registerObjectTools } from './tools/objects.js';
import { registerRelationshipAndSubscriptionTools } from './tools/misc.js';
import { registerNotifyTool } from './tools/notify.js';
import { registerRunsTool } from './tools/runs.js';
import { clearTokenCache } from './auth.js';
import { recordRunStart } from './data/runs.js';

let db: Database;

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from notifications where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from object_revisions where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from object_events where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from objects where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from users where email like '%@mcp-test.local'`);
}

async function seedUser(label: string): Promise<{ id: string; token: string }> {
  const token = `tok_${label}_${randomBytes(8).toString('hex')}`;
  const email = `${label}-${randomBytes(4).toString('hex')}@mcp-test.local`;
  const [row] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: 'x',
      displayName: label,
      mcpToken: token,
    })
    .returning({ id: schema.users.id, token: schema.users.mcpToken });
  if (!row) throw new Error('failed to seed user');
  return { id: row.id, token: row.token };
}

let app: Hono;
const registry = new ToolRegistry();
registerObjectTools(registry);
registerRelationshipAndSubscriptionTools(registry);
registerNotifyTool(registry);
registerRunsTool(registry);
app = buildMcpApp(registry);

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
          clientInfo: { name: 't', version: '0' },
        },
      }),
    }),
  );
  expect(res.status).toBe(200);
  const sid = res.headers.get('mcp-session-id');
  if (!sid) throw new Error('no session id');
  return sid;
}

interface ToolCallResult<T = unknown> {
  isError: boolean;
  text: string;
  parsed: T;
}

async function callTool<T = unknown>(
  sessionId: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult<T>> {
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
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.text();
  const m = /data: (\{.*\})/s.exec(body);
  if (!m || !m[1]) throw new Error(`no data line in response: ${body}`);
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

let userA: { id: string; token: string };
let userB: { id: string; token: string };
let sessionA: string;
let sessionB: string;

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  });
  await cleanup();
  clearTokenCache();
  userA = await seedUser('alice');
  userB = await seedUser('bob');
  sessionA = await initSession(userA.token);
  sessionB = await initSession(userB.token);
});
afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});
beforeEach(async () => {
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email like '%@mcp-test.local')`);
});

describe('get_recent_runs', () => {
  it('returns the user\'s runs, newest first, scoped per user', async () => {
    const sub = await callTool<{ subscription: { id: string } }>(sessionA, userA.token, 'create_subscription', {
      name: 'X',
      target: 't',
      instruction: 'i',
      cadence: 'daily',
      source: 's',
    });
    await recordRunStart(userA.id, { kind: 'subscription', subscriptionId: sub.parsed.subscription.id, prompt: 'run 1' });
    await new Promise((r) => setTimeout(r, 20));
    await recordRunStart(userA.id, { kind: 'subscription', subscriptionId: sub.parsed.subscription.id, prompt: 'run 2' });
    await recordRunStart(userB.id, { kind: 'subscription', prompt: "bob's run" });

    const res = await callTool<{ runs: Array<{ prompt: string; userId: string }> }>(
      sessionA,
      userA.token,
      'get_recent_runs',
      { limit: 10 },
    );
    expect(res.parsed.runs.length).toBe(2);
    expect(res.parsed.runs[0]?.prompt).toBe('run 2');
    expect(res.parsed.runs[1]?.prompt).toBe('run 1');
    expect(res.parsed.runs.every((r) => r.userId === userA.id)).toBe(true);
  });

  it('filters by status', async () => {
    await recordRunStart(userA.id, { kind: 'subscription', prompt: 'one' });
    const r2 = await recordRunStart(userA.id, { kind: 'subscription', prompt: 'two' });
    // mark r2 as failed
    await db
      .update(schema.hermesRuns)
      .set({ status: 'failed' })
      .where(sql`${schema.hermesRuns.id} = ${r2.id}`);

    const failed = await callTool<{ runs: Array<{ status: string }> }>(
      sessionA,
      userA.token,
      'get_recent_runs',
      { status: 'failed', limit: 10 },
    );
    expect(failed.parsed.runs.length).toBe(1);
    expect(failed.parsed.runs[0]?.status).toBe('failed');
  });
});
