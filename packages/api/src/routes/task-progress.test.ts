/**
 * Task scheduling + progress-log API tests.
 *
 * Covers the behaviours the Tasks page depends on:
 *   - a task assigned to a day shows on that day's board even when it was
 *     created earlier (the day bucket is NOT creation-dated),
 *   - the deadline window and per-day counts behind the week strip,
 *   - the shared progress log: user entries, Hermes entries, percent →
 *     status promotion,
 *   - progress on a DELEGATED task is relayed into that task's Hermes
 *     conversation (and only then),
 *   - delegation persists the guidance note and ships the log + deadline
 *     in the brief,
 *   - the dashboard reflects a scheduled-today task with its deadline.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from '../server.js';
import { setDb } from '../data/auth.js';
import { setDb as setMcpDb } from '@hermieos/mcp/src/data/db.js';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { makeFakeHermes, type FakeHermes } from '@hermieos/gateway/src/test-helpers/fake-hermes.js';

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let hermes: FakeHermes;
let cookie: string;
let userId: string;

const EMAIL = 'task-progress-api@hermieos.local';

function dayKey(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from task_updates where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from tasks where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from sessions where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from users where email = ${EMAIL}`);
}

beforeAll(async () => {
  db = createDatabase({ url: process.env.DATABASE_URL ?? 'postgres://hermieos:***@localhost:15432/hermieos' });
  setDb(db);
  setMcpDb(db);
  hermes = await makeFakeHermes();
  process.env.HERMES_GATEWAY_URL = hermes.url;
  process.env.HERMES_API_KEY = 'test-key';
  app = await buildApp();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  delete process.env.HERMES_GATEWAY_URL;
  delete process.env.HERMES_API_KEY;
  await hermes.close();
  await closeDatabase(db);
});

beforeEach(async () => {
  await cleanup();
  hermes.sessions.clear();
  hermes.messages.clear();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      email: EMAIL,
      password: 'correct-horse-battery',
      displayName: 'Task Progress',
    }),
  });
  expect(res.statusCode).toBe(200);
  cookie = (res.headers['set-cookie'] as string | undefined)?.split(';')[0] ?? '';
  userId = (res.json() as { user: { id: string } }).user.id;
});

interface CreatedTask {
  id: string;
  scheduledFor: string | null;
  dueAt: string | null;
  delegateNote: string | null;
  progressPercent: number;
  status: string;
}

async function createTask(payload: Record<string, unknown>): Promise<CreatedTask> {
  const res = await app.inject({
    method: 'POST',
    url: '/tasks',
    headers: { cookie, 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { task: CreatedTask }).task;
}

async function addUpdate(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: `/tasks/${taskId}/updates`,
    headers: { cookie, 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function delegate(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: `/tasks/${taskId}/delegate`,
    headers: { cookie, 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('task scheduling', () => {
  it('stores the assigned day, deadline and guidance note', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 2);
    const task = await createTask({
      title: 'Submit scholarship form',
      scheduledFor: dayKey(1),
      dueAt: due.toISOString(),
      delegateNote: 'Fill from the SOP PDF, then stop before submitting.',
    });
    expect(task.scheduledFor).toBe(dayKey(1));
    expect(task.dueAt).toBe(due.toISOString());
    expect(task.delegateNote).toBe('Fill from the SOP PDF, then stop before submitting.');
  });

  it("returns a task on the day's board even though it was created days earlier", async () => {
    const task = await createTask({ title: 'Scheduled ahead', scheduledFor: dayKey(0) });
    // Backdate createdAt to prove the day bucket is not creation-dated.
    await db.execute(
      sql`update tasks set created_at = now() - interval '9 days' where id = ${task.id}::uuid`,
    );
    const res = await app.inject({ method: 'GET', url: `/tasks?day=${dayKey(0)}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tasks: CreatedTask[]; day: string };
    expect(body.day).toBe(dayKey(0));
    expect(body.tasks.map((t) => t.id)).toContain(task.id);
  });

  it('keeps a task assigned to another day off today’s board', async () => {
    const task = await createTask({ title: 'Next week', scheduledFor: dayKey(5) });
    const res = await app.inject({ method: 'GET', url: `/tasks?day=${dayKey(0)}`, headers: { cookie } });
    const body = res.json() as { tasks: CreatedTask[] };
    expect(body.tasks.map((t) => t.id)).not.toContain(task.id);
  });

  it('returns per-day counts for the week range', async () => {
    await createTask({ title: 'Mon thing', scheduledFor: dayKey(0) });
    await createTask({ title: 'Wed thing', scheduledFor: dayKey(2) });
    const res = await app.inject({
      method: 'GET',
      url: `/tasks?from=${dayKey(0)}&to=${dayKey(6)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tasks: CreatedTask[];
      days: string[];
      counts: Record<string, { assigned: number; open: number }>;
    };
    expect(body.days).toHaveLength(7);
    expect(body.counts[dayKey(0)]?.assigned).toBe(1);
    expect(body.counts[dayKey(2)]?.assigned).toBe(1);
    expect(body.tasks).toHaveLength(2);
  });

  it('rejects a malformed day', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'Bad day', scheduledFor: '18-09-2026' }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('task progress log', () => {
  it('records a user entry and promotes todo → in_progress on a partial claim', async () => {
    const task = await createTask({ title: 'Draft the deck' });
    const { status, body } = await addUpdate(task.id, { body: 'Outline done', percent: 30 });
    expect(status).toBe(200);
    expect(body.progressPercent).toBe(30);
    expect(body.status).toBe('in_progress');

    const list = await app.inject({ method: 'GET', url: `/tasks/${task.id}/updates`, headers: { cookie } });
    const updates = (list.json() as { updates: Array<{ actor: string; body: string; percent: number }> }).updates;
    expect(updates).toHaveLength(1);
    expect(updates[0]?.actor).toBe('user');
    expect(updates[0]?.percent).toBe(30);
  });

  it('does not auto-complete at 100%', async () => {
    const task = await createTask({ title: 'Almost done' });
    const { body } = await addUpdate(task.id, { body: 'Everything except the appendix', percent: 100 });
    expect(body.progressPercent).toBe(100);
    expect(body.status).toBe('todo');
  });

  it('accepts a plain note without touching progress', async () => {
    const task = await createTask({ title: 'Notes only' });
    const { body } = await addUpdate(task.id, { body: 'Waiting on a reply from the office.' });
    expect(body.progressPercent).toBe(0);
    expect(body.status).toBe('todo');
  });

  it('404s for another user’s task', async () => {
    const task = await createTask({ title: 'Mine' });
    const other = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: `task-progress-other-${Date.now()}@hermieos.local`,
        password: 'correct-horse-battery',
        displayName: 'Other',
      }),
    });
    const otherCookie = (other.headers['set-cookie'] as string | undefined)?.split(';')[0] ?? '';
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}/updates`,
      headers: { cookie: otherCookie },
    });
    expect(res.statusCode).toBe(404);
    await db.execute(
      sql`delete from users where email like 'task-progress-other-%@hermieos.local'`,
    );
  });

  it('surfaces the newest entry on the task and lists it in the dashboard payload', async () => {
    const task = await createTask({ title: 'On today’s board', scheduledFor: dayKey(0) });
    await addUpdate(task.id, { body: 'Started', percent: 20 });
    const res = await app.inject({ method: 'GET', url: '/dashboard', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tasks: { today: Array<{ id: string; progressPercent: number; latestUpdate: { body: string } | null }> };
    };
    const found = body.tasks.today.find((t) => t.id === task.id);
    expect(found).toBeDefined();
    expect(found?.progressPercent).toBe(20);
    expect(found?.latestUpdate?.body).toBe('Started');
  });

  it('reflects the deadline on the today bucket', async () => {
    const due = new Date();
    due.setHours(23, 0, 0, 0);
    const task = await createTask({ title: 'Due today', scheduledFor: dayKey(0), dueAt: due.toISOString() });
    const res = await app.inject({ method: 'GET', url: '/dashboard', headers: { cookie } });
    const body = res.json() as { tasks: { today: Array<{ id: string; dueAt: string | null }> } };
    const found = body.tasks.today.find((t) => t.id === task.id);
    expect(found?.dueAt).toBe(due.toISOString());
  });
});

describe('progress on a delegated task', () => {
  it('relays the user’s entry into the task conversation', async () => {
    const task = await createTask({ title: 'Delegated work', delegateNote: 'Keep it short.' });
    const first = await delegate(task.id, {});
    expect(first.status).toBe(200);

    const { body } = await addUpdate(task.id, { body: 'I did the interviews myself', percent: 60 });
    expect(body.sharedWithHermes).toBe(true);

    const msgs = hermes.messages.get(`task-${task.id}`) ?? [];
    const relayed = msgs.filter(
      (m) => m.role === 'user' && String(m.content).includes('Progress update from the user'),
    );
    expect(relayed).toHaveLength(1);
    expect(String(relayed[0]?.content)).toContain('I did the interviews myself');
    expect(String(relayed[0]?.content)).toContain(`Task id: ${task.id}`);

    // The entry is stamped as shared.
    const list = await app.inject({ method: 'GET', url: `/tasks/${task.id}/updates`, headers: { cookie } });
    const updates = (list.json() as { updates: Array<{ sharedWithHermesAt: string | null }> }).updates;
    expect(updates[0]?.sharedWithHermesAt).not.toBeNull();
  });

  it('does not touch the gateway for a non-delegated task', async () => {
    const task = await createTask({ title: 'Just mine' });
    const { body } = await addUpdate(task.id, { body: 'Private note', percent: 10 });
    expect(body.sharedWithHermes).toBe(false);
    expect(hermes.messages.get(`task-${task.id}`)).toBeUndefined();
  });

  it('labels a handoff entry so Hermes knows the part is now the user’s', async () => {
    const task = await createTask({ title: 'Split work' });
    await delegate(task.id, {});
    await addUpdate(task.id, { body: 'The appendix is yours to write', kind: 'handoff' });
    const msgs = hermes.messages.get(`task-${task.id}`) ?? [];
    const relayed = msgs.filter((m) => m.role === 'user' && String(m.content).includes('now yours to do'));
    expect(relayed).toHaveLength(1);
  });
});

describe('delegation brief', () => {
  it('persists the guidance note and ships the log, deadline and task id', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const task = await createTask({
      title: 'Write the report',
      scheduledFor: dayKey(1),
      dueAt: due.toISOString(),
      notes: 'Cover Q2 numbers',
    });
    await addUpdate(task.id, { body: 'Pulled the raw numbers', percent: 25 });

    const res = await delegate(task.id, {
      note: 'Board wants one page max, cite the source spreadsheet.',
      context: 'Reviewer is the CFO.',
    });
    expect(res.status).toBe(200);
    expect(res.body.progressEntriesShared).toBe(1);

    const msgs = hermes.messages.get(`task-${task.id}`) ?? [];
    const brief = String(msgs[0]?.content ?? '');
    expect(brief).toContain('Task: Write the report');
    expect(brief).toContain(`Task id: ${task.id}`);
    expect(brief).toContain(`Scheduled for: ${dayKey(1)}`);
    expect(brief).toContain(`Deadline: ${due.toISOString()}`);
    expect(brief).toContain('Progress log so far (newest first)');
    expect(brief).toContain('Pulled the raw numbers');
    expect(brief).toContain('Guidance from the user for this task:');
    expect(brief).toContain('Board wants one page max');
    expect(brief).toContain('Context for this hand-off:');
    expect(brief).toContain('add_task_progress');

    // The note is stored on the task as the standing brief.
    const get = await app.inject({ method: 'GET', url: `/tasks/${task.id}`, headers: { cookie } });
    const body = get.json() as { task: { delegateNote: string | null; delegatedAt: string | null } };
    expect(body.task.delegateNote).toBe('Board wants one page max, cite the source spreadsheet.');
    expect(body.task.delegatedAt).not.toBeNull();
  });

  it('re-delegating keeps the stored note when no new one is sent', async () => {
    const task = await createTask({ title: 'Repeat hand-off' });
    await delegate(task.id, { note: 'Standing brief' });
    await delegate(task.id, {});
    const get = await app.inject({ method: 'GET', url: `/tasks/${task.id}`, headers: { cookie } });
    const body = get.json() as { task: { delegateNote: string | null } };
    expect(body.task.delegateNote).toBe('Standing brief');
  });

  it('lists only delegated tasks when filtered', async () => {
    const a = await createTask({ title: 'Handed over' });
    const b = await createTask({ title: 'Kept back' });
    await delegate(a.id, {});
    const res = await app.inject({ method: 'GET', url: '/tasks?delegated=true', headers: { cookie } });
    const ids = (res.json() as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });
});

describe('schema defaults', () => {
  it('leaves progressPercent at 0 and delegation null for a fresh task', async () => {
    const task = await createTask({ title: 'Fresh' });
    const [row] = await db.select().from(schema.tasks).where(sql`${schema.tasks.id} = ${task.id}::uuid`);
    expect(row?.progressPercent).toBe(0);
    expect(row?.delegatedAt).toBeNull();
    expect(row?.userId).toBe(userId);
  });
});
