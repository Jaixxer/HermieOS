/**
 * Finding conversation API tests.
 *
 * Drives POST /objects/:id/follow-up and GET /objects/:id/discuss
 * against a real Postgres DB and a real fake-Hermes gateway server,
 * so the whole path (feedback write → session create → chat / run
 * dispatch) is exercised end to end.
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

const EMAIL = 'discuss-api@hermieos.local';

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from feedback where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from object_relationships where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from object_revisions where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from object_events where user_id in (select id from users where email = ${EMAIL})`);
  await db.execute(sql`delete from objects where user_id in (select id from users where email = ${EMAIL})`);
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
      displayName: 'Discuss API',
    }),
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'] as string | undefined;
  cookie = setCookie?.split(';')[0] ?? '';
  userId = (res.json() as { user: { id: string } }).user.id;
});

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  useCookie = true,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (useCookie) headers['cookie'] = cookie;
  let payload: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await app.inject({ method, url, headers, payload });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = res.json() as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.statusCode, body: parsed };
}

async function seedFinding(): Promise<{ id: string }> {
  const r = await call('POST', '/objects', {
    type: 'research',
    title: 'A Paper About Agents',
    summary: 'A very interesting paper about agent tool use.',
    body: { url: 'https://arxiv.org/abs/2412.12345', kind: 'research_paper', stars: 42, source: 'arxiv:cs.AI' },
    tags: ['agents'],
  });
  expect(r.status).toBe(201);
  return { id: (r.body.object as { id: string }).id };
}

describe('GET /objects/:id/discuss', () => {
  it('returns the deterministic session id and exists=false before any conversation', async () => {
    const obj = await seedFinding();
    const r = await call('GET', `/objects/${obj.id}/discuss`);
    expect(r.status).toBe(200);
    expect(r.body.sessionId).toBe(`finding-${obj.id}`);
    expect(r.body.exists).toBe(false);
  });

  it('returns exists=true once the session exists on the gateway', async () => {
    const obj = await seedFinding();
    hermes.sessions.set(`finding-${obj.id}`, { id: `finding-${obj.id}`, source: 'api_server' });
    const r = await call('GET', `/objects/${obj.id}/discuss`);
    expect(r.status).toBe(200);
    expect(r.body.exists).toBe(true);
  });

  it('rejects other users and unauthenticated requests', async () => {
    const obj = await seedFinding();
    const anon = await app.inject({ method: 'GET', url: `/objects/${obj.id}/discuss` });
    expect(anon.statusCode).toBe(401);
    const otherEmail = `discuss-other-${randomBytes(4).toString('hex')}@hermieos.local`;
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
    const r = await app.inject({
      method: 'GET',
      url: `/objects/${obj.id}/discuss`,
      headers: { cookie: otherCookie },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('POST /objects/:id/follow-up — chat path', () => {
  it('records a suggest feedback row, creates the finding session, and posts the message with context', async () => {
    const obj = await seedFinding();
    const r = await call('POST', `/objects/${obj.id}/follow-up`, {
      message: 'Follow up on this paper — make a beginner summary and a project plan.',
    });
    expect(r.status).toBe(200);
    expect(r.body.sessionId).toBe(`finding-${obj.id}`);
    expect(r.body.background).toBe(false);

    // Session created on the gateway with the deterministic id.
    const session = hermes.sessions.get(`finding-${obj.id}`);
    expect(session).toBeDefined();
    expect(session?.title).toBe('A Paper About Agents');

    // The message arrived with the finding context attached.
    const msgs = hermes.messages.get(`finding-${obj.id}`) ?? [];
    expect(msgs).toHaveLength(2); // user + assistant echo
    const userMsg = String(msgs[0]?.content ?? '');
    expect(userMsg).toContain('Finding: A Paper About Agents');
    expect(userMsg).toContain('Summary: A very interesting paper');
    expect(userMsg).toContain('url: https://arxiv.org/abs/2412.12345');
    expect(userMsg).toContain('Follow up on this paper');

    // Feedback recorded for the ranking loop.
    const [feedback] = await db
      .select()
      .from(schema.feedback)
      .where(sql`${schema.feedback.userId} = ${userId} and ${schema.feedback.objectId} = ${obj.id}`);
    expect(feedback).toBeDefined();
    expect(feedback?.kind).toBe('suggest');
    const payload = feedback?.payload as Record<string, unknown> | null;
    expect(payload?.note).toBe('Follow up on this paper — make a beginner summary and a project plan.');
    expect(payload?.followUp).toBe(true);

    // No run row was created on the chat path.
    const runs = await db
      .select()
      .from(schema.hermesRuns)
      .where(sql`${schema.hermesRuns.userId} = ${userId}`);
    expect(runs).toHaveLength(0);
  });

  it('resumes an existing session instead of failing on a second follow-up', async () => {
    const obj = await seedFinding();
    const first = await call('POST', `/objects/${obj.id}/follow-up`, { message: 'first' });
    expect(first.status).toBe(200);
    const second = await call('POST', `/objects/${obj.id}/follow-up`, { message: 'second' });
    expect(second.status).toBe(200);
    const msgs = hermes.messages.get(`finding-${obj.id}`) ?? [];
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('400s on an empty message', async () => {
    const obj = await seedFinding();
    const r = await call('POST', `/objects/${obj.id}/follow-up`, { message: '' });
    expect(r.status).toBe(400);
  });
});

describe('POST /objects/:id/follow-up — background path', () => {
  it('dispatches a tracked ad_hoc research run and returns the run id', async () => {
    const obj = await seedFinding();
    const r = await call('POST', `/objects/${obj.id}/follow-up`, {
      message: 'Make this paper a project — plan the next 4 weeks.',
      runInBackground: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.background).toBe(true);
    expect(typeof r.body.runId).toBe('string');
    expect(r.body.sessionId).toBe(`finding-${obj.id}`);

    const [run] = await db
      .select()
      .from(schema.hermesRuns)
      .where(sql`${schema.hermesRuns.userId} = ${userId}`);
    expect(run).toBeDefined();
    expect(run?.kind).toBe('ad_hoc');
    expect(run?.status).toBe('running');
    expect(run?.hermesRunId).toBeTruthy();

    // The dispatch envelope routes to the research skill with the
    // finding as context.
    const envelope = JSON.parse(run?.prompt ?? '{}') as {
      event: string;
      objective: string;
      context: { object: { title: string; url: string | null } };
      trigger: string;
    };
    expect(envelope.event).toBe('research');
    expect(envelope.objective).toBe('Make this paper a project — plan the next 4 weeks.');
    expect(envelope.context.object.title).toBe('A Paper About Agents');
    expect(envelope.context.object.url).toBe('https://arxiv.org/abs/2412.12345');
    expect(envelope.trigger).toBe('user');

    // The gateway recorded the dispatch.
    expect(hermes.recorded.some((rec) => rec.sessionId === `hermieos-run-${run?.id}`)).toBe(true);

    // Feedback is recorded on the background path too.
    const [feedback] = await db
      .select()
      .from(schema.feedback)
      .where(sql`${schema.feedback.userId} = ${userId} and ${schema.feedback.objectId} = ${obj.id}`);
    expect(feedback?.kind).toBe('suggest');
  });
});

describe('follow-up error handling', () => {
  it('503s when the gateway is not configured', async () => {
    const obj = await seedFinding();
    const prevUrl = process.env.HERMES_GATEWAY_URL;
    delete process.env.HERMES_GATEWAY_URL;
    try {
      const r = await call('POST', `/objects/${obj.id}/follow-up`, { message: 'hi' });
      expect(r.status).toBe(503);
    } finally {
      process.env.HERMES_GATEWAY_URL = prevUrl;
    }
  });

  it('404s on another user\'s object', async () => {
    const obj = await seedFinding();
    const otherEmail = `discuss-other2-${randomBytes(4).toString('hex')}@hermieos.local`;
    const other = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: otherEmail,
        password: 'correct-horse-battery',
        displayName: 'Other2',
      }),
    });
    expect(other.statusCode).toBe(200);
    const otherCookie = (other.headers['set-cookie'] as string | undefined)?.split(';')[0] ?? '';
    const r = await app.inject({
      method: 'POST',
      url: `/objects/${obj.id}/follow-up`,
      headers: { cookie: otherCookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ message: 'steal' }),
    });
    expect(r.statusCode).toBe(404);
  });
});
