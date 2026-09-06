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
import { clearTokenCache } from './auth.js';

let db: Database;

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from notifications where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from object_revisions where user_id in (select id from users where email like '%@mcp-test.local')`);
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

const registry = new ToolRegistry();
registerObjectTools(registry);
registerRelationshipAndSubscriptionTools(registry);
registerNotifyTool(registry);
const app = buildMcpApp(registry);

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
let sessionA: string;

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:15432/hermieos',
  });
  await cleanup();
  clearTokenCache();
  userA = await seedUser('alice');
  sessionA = await initSession(userA.token);
});
afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});
beforeEach(async () => {
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from notifications where user_id in (select id from users where email like '%@mcp-test.local')`);
});

describe('notify_user rate limit', () => {
  it('succeeds for the first 5 calls in a day', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await callTool<{ notification: { id: string } }>(sessionA, userA.token, 'notify_user', {
        title: `n${i}`,
        message: 'm',
        priority: 'normal',
        source: 's',
      });
      expect(res.isError).toBe(false);
      expect(res.parsed.notification.id).toBeTruthy();
    }
  });

  it('rejects the 6th call in a day with a clear error', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await callTool(sessionA, userA.token, 'notify_user', {
        title: `n${i}`,
        message: 'm',
        priority: 'normal',
        source: 's',
      });
      expect(r.isError).toBe(false);
    }
    const sixth = await callTool(sessionA, userA.token, 'notify_user', {
      title: 'too many',
      message: 'm',
      priority: 'normal',
      source: 's',
    });
    expect(sixth.isError).toBe(true);
    expect(sixth.text).toMatch(/rate limit/i);
  });

  it('does not count notifications from yesterday', async () => {
    // Insert 5 notifications dated to yesterday, then a fresh one today.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      await db.insert(schema.notifications).values({
        userId: userA.id,
        title: `old${i}`,
        message: 'm',
        priority: 'normal',
        createdAt: yesterday,
      });
    }
    const today = await callTool(sessionA, userA.token, 'notify_user', {
      title: 'fresh',
      message: 'm',
      priority: 'normal',
      source: 's',
    });
    expect(today.isError).toBe(false);
  });

  it("'notify_user' can attach to an owned object", async () => {
    const obj = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery',
      title: 'o',
      source: 's',
    });
    const n = await callTool(sessionA, userA.token, 'notify_user', {
      title: 'hello',
      message: 'm',
      priority: 'high',
      objectId: obj.parsed.object.id,
      source: 's',
    });
    expect(n.isError).toBe(false);
    // confirm object_id is set
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(sql`${schema.notifications.userId} = ${userA.id}`);
    expect(rows[rows.length - 1]?.objectId).toBe(obj.parsed.object.id);
  });

  it('a notification also creates a feed_event', async () => {
    await callTool(sessionA, userA.token, 'notify_user', {
      title: 'feed-test',
      message: 'm',
      priority: 'normal',
      source: 's',
    });
    const feed = await callTool<{ events: Array<{ kind: string; title: string }> }>(
      sessionA,
      userA.token,
      'get_recent_activity',
      { limit: 5, kinds: ['notification'] },
    );
    expect(feed.parsed.events.some((e) => e.kind === 'notification' && e.title === 'feed-test')).toBe(true);
  });
});
