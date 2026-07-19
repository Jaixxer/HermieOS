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
let bobCookie: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from sessions where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from users where email like '%@api-test.local'`);
}

async function signup(
  email: string,
  displayName: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password: 'correct-horse-battery', displayName }),
  });
  if (res.statusCode !== 200) throw new Error(`signup failed: ${res.statusCode}`);
  const body = res.json() as { user: { id: string } };
  const setCookie = res.headers['set-cookie'] as string | undefined;
  if (!setCookie) throw new Error('no cookie set');
  const cookie = setCookie.split(';')[0] ?? '';
  return { cookie, userId: body.user.id };
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
  const a = await signup('alice@api-test.local', 'Alice');
  aliceCookie = a.cookie;
  aliceId = a.userId;
  const b = await signup('bob@api-test.local', 'Bob');
  bobCookie = b.cookie;
});

const SSE_POLL_MS = Number(process.env.SSE_POLL_MS ?? 200);

describe('openEventStream (bus) — direct test', () => {
  it('emits alice\'s feed events but not bob\'s', async () => {
    const { openEventStream, setDb } = await import('./sse-bus.js');
    setDb(db);
    const aliceReceived: string[] = [];
    const aliceHandle = openEventStream(aliceId, {
      onEvent: (e) => {
        if (e.type === 'feed') aliceReceived.push(e.event.title);
      },
    });
    try {
      await db.insert(schema.feedEvents).values({
        userId: aliceId,
        kind: 'object_created',
        objectId: null,
        title: 'alice-direct',
        payload: { source: 'test' },
      });
      const [bob] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`${schema.users.email} = 'bob@api-test.local'`);
      if (!bob) throw new Error('bob missing');
      await db.insert(schema.feedEvents).values({
        userId: bob.id,
        kind: 'object_created',
        objectId: null,
        title: 'bob-direct',
        payload: { source: 'test' },
      });
      await new Promise((r) => setTimeout(r, SSE_POLL_MS * 3 + 100));
      expect(aliceReceived).toContain('alice-direct');
      expect(aliceReceived).not.toContain('bob-direct');
    } finally {
      aliceHandle.close();
    }
  });
});

describe('GET /events (SSE)', () => {
  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { accept: 'text/event-stream' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('opens an SSE stream for an authenticated user', async () => {
    // The inject()-based stream is buffered by the test runner, so we
    // can't read events back. We just confirm the route is wired and
    // returns 200 for an authenticated user. The cross-user test below
    // verifies that the bus does not leak across users, and we trust
    // openEventStream's direct tests for the streaming logic.
    const res = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { accept: 'text/event-stream', cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    // The status 200 is enough; headers and body framing are exercised
    // by the plugin itself.
  });

  it('does not deliver bob\'s events to alice', async () => {
    // Direct test of the bus: open a stream for alice, insert bob's
    // event, and confirm the bus does not surface it.
    const { openEventStream } = await import('./sse-bus.js');
    const received: string[] = [];
    const handle = openEventStream(aliceId, {
      onEvent: (event) => {
        if (event.type === 'feed') received.push(event.event.title);
      },
    });
    try {
      const [bob] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`${schema.users.email} = 'bob@api-test.local'`);
      if (!bob) throw new Error('bob missing');
      await db.insert(schema.feedEvents).values({
        userId: bob.id,
        kind: 'object_created',
        objectId: null,
        title: 'bob-only-event',
        payload: { source: 'test' },
      });
      // Wait one poll cycle.
      await new Promise((r) => setTimeout(r, SSE_POLL_MS + 200));
      expect(received).not.toContain('bob-only-event');
    } finally {
      handle.close();
    }
  });
});
