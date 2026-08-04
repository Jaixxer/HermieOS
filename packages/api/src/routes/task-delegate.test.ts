/**
 * Task delegation API tests.
 *
 * POST /tasks/:id/delegate hands ONE task to Hermes via a dedicated
 * gateway session (task-<id>), with optional user context. The task
 * stays on the user's mission and is marked sentToHermesAt.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
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

const EMAIL = 'delegate-api@hermieos.local';

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from tasks where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from sessions where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from users where email = ${EMAIL}`);
}

beforeAll(async () => {
  db = createDatabase({ url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos' });
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
      displayName: 'Delegate API',
    }),
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'] as string | undefined;
  cookie = setCookie?.split(';')[0] ?? '';
  userId = (res.json() as { user: { id: string } }).user.id;
});

async function seedTask(title = 'Write the quarterly report'): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/tasks',
    headers: { cookie, 'content-type': 'application/json' },
    payload: JSON.stringify({ title, category: 'work', notes: 'Cover Q2 numbers' }),
  });
  expect(res.statusCode).toBe(200);
  return { id: (res.json() as { task: { id: string } }).task.id };
}

describe('POST /tasks/:id/delegate', () => {
  it('creates the task session, posts the brief with context, and marks the task delegated', async () => {
    const task = await seedTask();
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/delegate`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ context: 'The board wants it by Friday. Keep it to one page.' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessionId: string; delegated: boolean };
    expect(body.sessionId).toBe(`task-${task.id}`);
    expect(body.delegated).toBe(true);

    // Session created with the task title.
    const session = hermes.sessions.get(`task-${task.id}`);
    expect(session).toBeDefined();
    expect(session?.title).toBe('Write the quarterly report');

    // Message contains the task brief + the user's context + the "do it" ask.
    const msgs = hermes.messages.get(`task-${task.id}`) ?? [];
    expect(msgs).toHaveLength(2);
    const sent = String(msgs[0]?.content ?? '');
    expect(sent).toContain('Task: Write the quarterly report');
    expect(sent).toContain('Notes: Cover Q2 numbers');
    expect(sent).toContain('Context from the user:');
    expect(sent).toContain('The board wants it by Friday.');
    expect(sent).toContain('take on this task and do it');

    // Task marked as delegated.
    const [row] = await db
      .select()
      .from(schema.tasks)
      .where(sql`${schema.tasks.id} = ${task.id}`);
    expect(row?.sentToHermesAt).not.toBeNull();
  });

  it('delegates without context (plain brief only)', async () => {
    const task = await seedTask();
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/delegate`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    const msgs = hermes.messages.get(`task-${task.id}`) ?? [];
    const sent = String(msgs[0]?.content ?? '');
    expect(sent).not.toContain('Context from the user:');
    expect(sent).toContain('take on this task and do it');
  });

  it('re-using the same session resumes the conversation (second delegate appends)', async () => {
    const task = await seedTask();
    await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/delegate`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ context: 'first' }),
    });
    const second = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/delegate`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ context: 'second' }),
    });
    expect(second.statusCode).toBe(200);
    const msgs = hermes.messages.get(`task-${task.id}`) ?? [];
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('404s for another user\'s task', async () => {
    const task = await seedTask();
    const otherEmail = `delegate-other-${randomBytes(4).toString('hex')}@hermieos.local`;
    const other = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: otherEmail,
        password: 'correct-horse-battery',
        displayName: 'Other',
      }),
    });
    expect(other.statusCode).toBe(200);
    const otherCookie = (other.headers['set-cookie'] as string | undefined)?.split(';')[0] ?? '';
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/delegate`,
      headers: { cookie: otherCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(404);
  });

  it('503s when the gateway is not configured', async () => {
    const task = await seedTask();
    const prevUrl = process.env.HERMES_GATEWAY_URL;
    delete process.env.HERMES_GATEWAY_URL;
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/tasks/${task.id}/delegate`,
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(503);
    } finally {
      process.env.HERMES_GATEWAY_URL = prevUrl;
    }
  });
});
