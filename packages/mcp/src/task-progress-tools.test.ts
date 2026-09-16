/**
 * MCP tool tests for task scheduling + the shared progress log.
 *
 * These exercise the real tool path Hermes uses, so they prove the loop the
 * feature depends on: Hermes can schedule a task to a day, report progress
 * onto it, read the log back, and see the day's board on the dashboard.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { registerDashboardTools } from './tools/dashboard.js';
import { clearTokenCache } from './auth.js';

let db: Database;

async function cleanup(): Promise<void> {
  await db.execute(
    sql`delete from task_updates where user_id in (select id from users where email like '%@task-tools-test.local')`,
  );
  await db.execute(
    sql`delete from tasks where user_id in (select id from users where email like '%@task-tools-test.local')`,
  );
  await db.execute(sql`delete from users where email like '%@task-tools-test.local'`);
}

async function seedUser(label: string): Promise<{ id: string; token: string }> {
  const token = `tok_${label}_${randomBytes(8).toString('hex')}`;
  const email = `${label}-${randomBytes(4).toString('hex')}@task-tools-test.local`;
  const [row] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'x', displayName: label, mcpToken: token })
    .returning({ id: schema.users.id, token: schema.users.mcpToken });
  if (!row) throw new Error('failed to seed user');
  return { id: row.id, token: row.token };
}

const registry = new ToolRegistry();
registerDashboardTools(registry);
const app = buildMcpApp(registry);

async function callTool<T = unknown>(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string; parsed: T }> {
  const init = await app.fetch(
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
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    }),
  );
  const sessionId = init.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('no session id');

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
  const m = /data: (\{.*\})/s.exec(body);
  if (!m?.[1]) throw new Error(`no data line in response: ${body}`);
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
  return { isError: !!parsed.result?.isError, text: content.text, parsed: value };
}

function dayKey(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeAll(async () => {
  db = createDatabase({ url: process.env.DATABASE_URL ?? 'postgres://hermieos:***@localhost:15432/hermieos' });
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

interface ToolTask {
  id: string;
  title: string;
  scheduledFor: string | null;
  dueAt: string | null;
  delegateNote: string | null;
  progressPercent: number;
  status: string;
  latestUpdate?: { body: string; actor: string; percent: number | null } | null;
}

describe('task tools', () => {
  it('create_task accepts a day assignment, deadline and brief', async () => {
    const { token } = await seedUser('create');
    const due = new Date();
    due.setDate(due.getDate() + 3);
    const r = await callTool<{ task: ToolTask }>(token, 'create_task', {
      title: 'Ship the landing page',
      scheduledFor: dayKey(1),
      dueAt: due.toISOString(),
      delegateNote: 'Use the existing brand tokens.',
      category: 'work',
      source: 'test',
    });
    expect(r.isError).toBe(false);
    expect(r.parsed.task.scheduledFor).toBe(dayKey(1));
    expect(r.parsed.task.dueAt).toBe(due.toISOString());
    expect(r.parsed.task.delegateNote).toBe('Use the existing brand tokens.');
    expect(r.parsed.task.progressPercent).toBe(0);
  });

  it('add_task_progress writes an entry Hermes can read back, and promotes todo → in_progress', async () => {
    const { token } = await seedUser('progress');
    const created = await callTool<{ task: ToolTask }>(token, 'create_task', {
      title: 'Research visa requirements',
      source: 'test',
    });
    const id = created.parsed.task.id;

    const add = await callTool<{ updated: boolean; progressPercent: number; status: string }>(
      token,
      'add_task_progress',
      { id, body: 'Collected the official checklist.', percent: 40 },
    );
    expect(add.isError).toBe(false);
    expect(add.parsed.updated).toBe(true);
    expect(add.parsed.progressPercent).toBe(40);
    expect(add.parsed.status).toBe('in_progress');

    const list = await callTool<{ found: boolean; updates: Array<{ actor: string; body: string; percent: number }> }>(
      token,
      'list_task_progress',
      { id, limit: 10 },
    );
    expect(list.parsed.found).toBe(true);
    expect(list.parsed.updates).toHaveLength(1);
    expect(list.parsed.updates[0]?.actor).toBe('hermes');
    expect(list.parsed.updates[0]?.body).toBe('Collected the official checklist.');
  });

  it('get_task returns the log so a later run can continue where it stopped', async () => {
    const { token } = await seedUser('gettask');
    const created = await callTool<{ task: ToolTask }>(token, 'create_task', { title: 'Resume me', source: 'test' });
    const id = created.parsed.task.id;
    await callTool(token, 'add_task_progress', { id, body: 'Section 1 done', percent: 25 });
    await callTool(token, 'add_task_progress', { id, body: 'Section 2 done', percent: 50 });

    const got = await callTool<{ task: ToolTask; updates: Array<{ body: string; actor: string }> }>(token, 'get_task', {
      id,
    });
    expect(got.parsed.updates).toHaveLength(2);
    // Newest first.
    expect(got.parsed.updates[0]?.body).toBe('Section 2 done');
    expect(got.parsed.task.progressPercent).toBe(50);
  });

  it('records a blocker the user has to resolve', async () => {
    const { token } = await seedUser('blocker');
    const created = await callTool<{ task: TaskRow }>(token, 'create_task', { title: 'Needs a decision', source: 'test' });
    const id = created.parsed.task.id;
    await callTool(token, 'add_task_progress', {
      id,
      kind: 'blocker',
      body: 'Which bank account should the transfer come from?',
    });
    const list = await callTool<{ updates: Array<{ kind: string }> }>(token, 'list_task_progress', { id });
    expect(list.parsed.updates[0]?.kind).toBe('blocker');
  });

  it('rejects progress on a task that does not exist', async () => {
    const { token } = await seedUser('missing');
    const r = await callTool<{ updated: boolean; reason: string }>(token, 'add_task_progress', {
      id: '00000000-0000-4000-8000-000000000000',
      body: 'ghost',
    });
    expect(r.parsed.updated).toBe(false);
    expect(r.parsed.reason).toBe('task_not_found');
  });

  it('move a task to another day and filter by day / delegated state', async () => {
    const { token } = await seedUser('filters');
    const created = await callTool<{ task: ToolTask }>(token, 'create_task', {
      title: 'Movable',
      scheduledFor: dayKey(0),
      source: 'test',
    });
    const id = created.parsed.task.id;

    const moved = await callTool<{ task: ToolTask }>(token, 'update_task', {
      id,
      scheduledFor: dayKey(4),
      source: 'test',
    });
    expect(moved.parsed.task.scheduledFor).toBe(dayKey(4));

    const today = await callTool<{ tasks: ToolTask[] }>(token, 'list_tasks', { scheduledFor: dayKey(0) });
    expect(today.parsed.tasks.map((t) => t.id)).not.toContain(id);

    const target = await callTool<{ tasks: ToolTask[] }>(token, 'list_tasks', { scheduledFor: dayKey(4) });
    expect(target.parsed.tasks.map((t) => t.id)).toContain(id);

    // Nothing is delegated yet.
    const delegated = await callTool<{ tasks: ToolTask[] }>(token, 'list_tasks', { delegated: true });
    expect(delegated.parsed.tasks).toHaveLength(0);
  });

  it('puts a task assigned to today on the dashboard board, with its progress', async () => {
    const { token } = await seedUser('dashboard');
    const created = await callTool<{ task: ToolTask }>(token, 'create_task', {
      title: 'On the board today',
      scheduledFor: dayKey(0),
      source: 'test',
    });
    const id = created.parsed.task.id;
    await callTool(token, 'add_task_progress', { id, body: 'Kicked off', percent: 15 });

    const dash = await callTool<{
      tasks: { today: ToolTask[]; overdue: TaskRow[] };
    }>(token, 'get_dashboard', {});
    const found = dash.parsed.tasks.today.find((t) => t.id === id);
    expect(found).toBeDefined();
    expect(found?.progressPercent).toBe(15);
    expect(found?.latestUpdate?.body).toBe('Kicked off');
  });

  it('keeps a task scheduled for another day off today’s dashboard board', async () => {
    const { token } = await seedUser('offboard');
    const created = await callTool<{ task: ToolTask }>(token, 'create_task', {
      title: 'Later this week',
      scheduledFor: dayKey(4),
      source: 'test',
    });
    const dash = await callTool<{ tasks: { today: ToolTask[] } }>(token, 'get_dashboard', {});
    expect(dash.parsed.tasks.today.map((t) => t.id)).not.toContain(created.parsed.task.id);
  });
});

interface TaskRow {
  id: string;
}
