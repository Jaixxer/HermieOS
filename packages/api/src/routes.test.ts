import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from './server.js';
import { setDb } from './data/auth.js';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import type { FastifyInstance } from 'fastify';

let db: Database;
let app: FastifyInstance;
let aliceCookie: string;
let aliceId: string;
let aliceMcpToken: string;
let bobCookie: string;
let bobId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from feedback where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from hermes_runs where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from object_revisions where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from object_events where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from objects where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from sessions where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from users where email like '%@api-test.local'`);
}

async function signup(
  email: string,
  displayName: string,
): Promise<{ cookie: string; mcpToken: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password: 'correct-horse-battery', displayName }),
  });
  if (res.statusCode !== 200) throw new Error(`signup failed: ${res.statusCode}`);
  const body = res.json() as { user: { id: string }; mcpToken: string };
  const setCookie = res.headers['set-cookie'] as string | undefined;
  if (!setCookie) throw new Error('no cookie set');
  const cookie = setCookie.split(';')[0] ?? '';
  return { cookie, mcpToken: body.mcpToken, userId: body.user.id };
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers['cookie'] = opts.cookie;
  const res = await app.inject({
    method,
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
  return { status: res.statusCode, body };
}

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  });
  setDb(db);
  app = await buildApp();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await app.close();
  await closeDatabase(db);
});
beforeEach(async () => {
  await cleanup();
  // Re-seed users each test (cookies become invalid after cleanup).
  const a = await signup('alice@api-test.local', 'Alice');
  aliceCookie = a.cookie;
  aliceId = a.userId;
  aliceMcpToken = a.mcpToken;
  const b = await signup('bob@api-test.local', 'Bob');
  bobCookie = b.cookie;
  bobId = b.userId;
});

describe('GET /me', () => {
  it('returns the current user', async () => {
    const res = await call('GET', '/me', { cookie: aliceCookie });
    expect(res.status).toBe(200);
    expect((res.body.user as { id: string }).id).toBe(aliceId);
  });

  it('returns 401 without a session', async () => {
    const res = await call('GET', '/me');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /me/scheduler', () => {
  it('toggles the pause flag', async () => {
    const r1 = await call('PATCH', '/me/scheduler', {
      body: { enabled: false },
      cookie: aliceCookie,
    });
    expect(r1.status).toBe(200);
    expect((r1.body.user as { schedulerEnabled: boolean }).schedulerEnabled).toBe(false);

    const r2 = await call('PATCH', '/me/scheduler', {
      body: { enabled: true },
      cookie: aliceCookie,
    });
    expect((r2.body.user as { schedulerEnabled: boolean }).schedulerEnabled).toBe(true);

    const [row] = await db
      .select({ enabled: schema.users.schedulerEnabled })
      .from(schema.users)
      .where(sql`${schema.users.id} = ${aliceId}`);
    expect(row?.enabled).toBe(true);
  });

  it('returns 400 on invalid body', async () => {
    const r = await call('PATCH', '/me/scheduler', { body: { enabled: 'no' }, cookie: aliceCookie });
    expect(r.status).toBe(400);
  });
});

describe('POST /me/mcp-token/rotate', () => {
  it('rotates the mcp_token and returns the new one once', async () => {
    const r = await call('POST', '/me/mcp-token/rotate', { cookie: aliceCookie });
    expect(r.status).toBe(200);
    expect(typeof r.body.mcpToken).toBe('string');
    expect((r.body.mcpToken as string).startsWith('mcp_')).toBe(true);
    expect(r.body.mcpToken).not.toBe(aliceMcpToken);

    const [row] = await db
      .select({ token: schema.users.mcpToken })
      .from(schema.users)
      .where(sql`${schema.users.id} = ${aliceId}`);
    expect(row?.token).toBe(r.body.mcpToken);
  });
});

describe('feed + objects + search', () => {
  let objA: { id: string };

  beforeEach(async () => {
    // Seed an object directly so we have known feed state.
    const [row] = await db
      .insert(schema.objects)
      .values({
        userId: aliceId,
        type: 'research',
        title: 'ESP32 power optimization',
        summary: 'Reducing quiescent draw on battery-powered sensors',
        body: { methodology: 'measured with uCurrent' },
        createdBy: 'user',
      })
      .returning();
    if (!row) throw new Error('seed failed');
    objA = { id: row.id };
    await db.insert(schema.objectRevisions).values({
      objectId: row.id,
      userId: aliceId,
      revision: 1,
      body: row.body,
      summary: row.summary,
      title: row.title,
      status: row.status,
      actor: 'user',
    });
    await db.insert(schema.objectEvents).values({
      objectId: row.id,
      userId: aliceId,
      kind: 'created',
      actor: 'user',
      payload: { source: 'test' },
    });
    await db.insert(schema.feedEvents).values({
      userId: aliceId,
      kind: 'object_created',
      objectId: row.id,
      title: row.title,
      body: row.summary,
      payload: { type: row.type },
    });
  });

  it('GET /feed returns the user\'s events', async () => {
    const r = await call('GET', '/feed', { cookie: aliceCookie });
    expect(r.status).toBe(200);
    const events = r.body.events as Array<{ kind: string; title: string }>;
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe('object_created');
  });

  it('GET /feed does not return another user\'s events', async () => {
    const r = await call('GET', '/feed', { cookie: bobCookie });
    const events = r.body.events as Array<unknown>;
    expect(events.length).toBe(0);
  });

  it('GET /feed/unread-count returns the unread count', async () => {
    const r = await call('GET', '/feed/unread-count', { cookie: aliceCookie });
    expect(r.status).toBe(200);
    expect((r.body.unread as number) >= 1).toBe(true);
  });

  it('POST /feed/mark-read marks all older events read', async () => {
    const now = new Date().toISOString();
    const r = await call('POST', '/feed/mark-read', { body: { upTo: now }, cookie: aliceCookie });
    expect(r.status).toBe(200);
    const after = await call('GET', '/feed/unread-count', { cookie: aliceCookie });
    expect(after.body.unread).toBe(0);
  });

  it('GET /objects/:id returns the object with its current revision', async () => {
    const r = await call('GET', `/objects/${objA.id}`, { cookie: aliceCookie });
    expect(r.status).toBe(200);
    const obj = r.body.object as { id: string; title: string; revision: number };
    expect(obj.id).toBe(objA.id);
    expect(obj.revision).toBe(1);
  });

  it('GET /objects/:id returns 404 for another user', async () => {
    const r = await call('GET', `/objects/${objA.id}`, { cookie: bobCookie });
    expect(r.status).toBe(404);
  });

  it('GET /objects/:id/timeline returns the events in reverse order', async () => {
    const r = await call('GET', `/objects/${objA.id}/timeline`, { cookie: aliceCookie });
    const events = r.body.events as Array<{ kind: string }>;
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe('created');
  });

  it('GET /objects/:id/revisions/:revision returns a specific revision', async () => {
    const r = await call('GET', `/objects/${objA.id}/revisions/1`, { cookie: aliceCookie });
    expect(r.status).toBe(200);
    const rev = r.body.revision as { revision: number; title: string };
    expect(rev.revision).toBe(1);
    expect(rev.title).toBe('ESP32 power optimization');
  });

  it('GET /search?q=ESP32 finds the seeded object', async () => {
    const r = await call('GET', '/search?q=ESP32', { cookie: aliceCookie });
    expect(r.status).toBe(200);
    const hits = r.body.hits as Array<{ title: string; rank: number; snippet: string }>;
    expect(hits.length).toBe(1);
    expect(hits[0]?.title).toContain('ESP32');
    expect(hits[0]?.rank).toBeGreaterThan(0);
  });

  it('GET /search does not return another user\'s objects', async () => {
    const r = await call('GET', '/search?q=ESP32', { cookie: bobCookie });
    const hits = r.body.hits as Array<unknown>;
    expect(hits.length).toBe(0);
  });
});

describe('object write APIs (HTTP)', () => {
  it('POST /objects/:id/feedback records a like', async () => {
    const [obj] = await db
      .insert(schema.objects)
      .values({
        userId: aliceId,
        type: 'research',
        title: 'fb',
        body: {},
        createdBy: 'user',
      })
      .returning();
    if (!obj) throw new Error('seed failed');
    const r = await call('POST', `/objects/${obj.id}/feedback`, {
      body: { kind: 'like' },
      cookie: aliceCookie,
    });
    expect(r.status).toBe(200);
    const fb = r.body.feedback as { kind: string };
    expect(fb.kind).toBe('like');
  });

  it('POST /objects/:id/feedback with invalid kind returns 400', async () => {
    const [obj] = await db
      .insert(schema.objects)
      .values({
        userId: aliceId,
        type: 'research',
        title: 'fb2',
        body: {},
        createdBy: 'user',
      })
      .returning();
    if (!obj) throw new Error('seed failed');
    const r = await call('POST', `/objects/${obj.id}/feedback`, {
      body: { kind: 'sneeze' },
      cookie: aliceCookie,
    });
    expect(r.status).toBe(400);
  });
});

describe('subscription APIs', () => {
  it('POST /subscriptions creates, GET /subscriptions lists, PATCH /subscriptions/:id updates, POST /subscriptions/:id/archive archives', async () => {
    const c = await call('POST', '/subscriptions', {
      body: { name: 'Watcher', target: 't', instruction: 'check', cadence: 'daily' },
      cookie: aliceCookie,
    });
    expect(c.status).toBe(200);
    const created = c.body.subscription as { id: string; name: string; status: string; nextRunAt: string };
    expect(created.name).toBe('Watcher');
    expect(created.status).toBe('active');
    const nextRunAt = new Date(created.nextRunAt).getTime();
    expect(nextRunAt).toBeGreaterThan(Date.now());

    const l = await call('GET', '/subscriptions', { cookie: aliceCookie });
    const list = l.body.subscriptions as Array<{ id: string }>;
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(created.id);

    const p = await call('PATCH', `/subscriptions/${created.id}`, {
      body: { name: 'Renamed' },
      cookie: aliceCookie,
    });
    expect(p.status).toBe(200);
    const updated = p.body.subscription as { name: string };
    expect(updated.name).toBe('Renamed');

    const a = await call('POST', `/subscriptions/${created.id}/archive`, { cookie: aliceCookie });
    expect(a.status).toBe(200);
    const arch = a.body.subscription as { status: string };
    expect(arch.status).toBe('archived');
  });

  it('GET /subscriptions does not return another user\'s subs', async () => {
    await call('POST', '/subscriptions', {
      body: { name: 'A', target: 't', instruction: 'i', cadence: 'daily' },
      cookie: aliceCookie,
    });
    const l = await call('GET', '/subscriptions', { cookie: bobCookie });
    expect((l.body.subscriptions as Array<unknown>).length).toBe(0);
  });
});

describe('runs API', () => {
  it('GET /runs returns the user\'s hermes_runs (empty for alice)', async () => {
    const r = await call('GET', '/runs', { cookie: aliceCookie });
    expect(r.status).toBe(200);
    expect((r.body.runs as Array<unknown>).length).toBe(0);
  });
});
