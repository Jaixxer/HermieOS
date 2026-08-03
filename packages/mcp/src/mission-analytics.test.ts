import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { randomBytes } from 'node:crypto';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { registerDashboardTools } from './tools/dashboard.js';
import { clearTokenCache } from './auth.js';

let db: Database;

async function cleanup(): Promise<void> {
  await db.execute(
    sql`delete from tasks where user_id in (select id from users where email like '%@mission-test.local')`,
  );
  await db.execute(sql`delete from users where email like '%@mission-test.local'`);
}

async function seedUser(label: string): Promise<{ id: string; token: string }> {
  const token = `tok_${label}_${randomBytes(8).toString('hex')}`;
  const email = `${label}-${randomBytes(4).toString('hex')}@mission-test.local`;
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
registerDashboardTools(registry);
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
          clientInfo: { name: 'test', version: '0' },
        },
      }),
    }),
  );
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('no session id');
  return sessionId;
}

interface ToolCallResult<T = unknown> {
  isError: boolean;
  text: string;
  parsed: T;
}

async function callTool<T = unknown>(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult<T>> {
  const sessionId = await initSession(token);
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
        id: 2,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.text();
  // body is SSE: "event: message\ndata: {...}\n\n" — extract the JSON.
  const m = /data: (\{.*\})/s.exec(body);
  if (!m || !m[1]) throw new Error(`no data line in response: ${body}`);
  const parsed = JSON.parse(m[1]) as {
    result?: { isError?: boolean; content?: Array<{ type: string; text: string }> };
  };
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
  return {
    isError: !!parsed.result?.isError,
    text: content.text,
    parsed: value,
  };
}

const createdUsers: string[] = [];

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  });
  await cleanup();
  clearTokenCache();
});

afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});

beforeEach(async () => {
  await cleanup();
});

describe('get_task_analytics', () => {
  it('returns zeros for a user with no tasks', async () => {
    const { id, token } = await seedUser('alice');
    createdUsers.push(id);
    const r = await callTool<{
      today: { total: number; completed: number; pending: number; overdue: number; completionRate: number };
      deferredTomorrow: number;
      last7Days: Array<{ date: string; created: number; completed: number }>;
    }>(token, 'get_task_analytics', { days: 7 });
    expect(r.isError).toBe(false);
    expect(r.parsed.today.total).toBe(0);
    expect(r.parsed.today.completed).toBe(0);
    expect(r.parsed.deferredTomorrow).toBe(0);
    expect(r.parsed.last7Days.length).toBe(7);
  });

  it('counts completed, pending, overdue, and deferred tasks', async () => {
    const { id, token } = await seedUser('alice');
    createdUsers.push(id);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    await db.insert(schema.tasks).values({
      userId: id,
      title: 'done today',
      category: 'work',
      status: 'done',
      completedAt: now,
      createdBy: 'user',
    });
    await db.insert(schema.tasks).values({
      userId: id,
      title: 'due today',
      category: 'work',
      status: 'todo',
      dueAt: today,
      createdBy: 'user',
    });
    await db.insert(schema.tasks).values({
      userId: id,
      title: 'overdue',
      category: 'health',
      status: 'todo',
      dueAt: yesterday,
      createdBy: 'user',
    });
    await db.insert(schema.tasks).values({
      userId: id,
      title: 'tomorrow task',
      category: 'learning',
      status: 'todo',
      dueAt: tomorrow,
      createdBy: 'user',
    });

    const r = await callTool<{
      today: { total: number; completed: number; pending: number; overdue: number; completionRate: number };
      deferredTomorrow: number;
    }>(token, 'get_task_analytics', { days: 7 });
    expect(r.isError).toBe(false);
    expect(r.parsed.today.total).toBe(3);
    expect(r.parsed.today.completed).toBe(1);
    expect(r.parsed.today.pending).toBe(2);
    expect(r.parsed.today.overdue).toBe(1);
    expect(r.parsed.today.completionRate).toBeCloseTo(1 / 3, 5);
    expect(r.parsed.deferredTomorrow).toBe(1);
  });

  it('does not leak another user\'s tasks', async () => {
    const a = await seedUser('alice');
    const b = await seedUser('bob');
    createdUsers.push(a.id, b.id);
    await db.insert(schema.tasks).values({
      userId: b.id,
      title: 'bob private',
      category: 'other',
      status: 'todo',
      dueAt: new Date(),
      createdBy: 'user',
    });
    const r = await callTool<{ today: { total: number } }>(a.token, 'get_task_analytics', { days: 7 });
    expect(r.parsed.today.total).toBe(0);
  });
});
