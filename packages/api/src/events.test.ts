import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
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
  await db.execute(sql`delete from notifications where user_id in (select id from users where email like '%@api-test.local')`);
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

  it('emits notification events for the user', async () => {
    const { openEventStream, setDb } = await import('./sse-bus.js');
    setDb(db);
    const aliceReceived: Array<{ type: string; title: string }> = [];
    const aliceHandle = openEventStream(aliceId, {
      onEvent: (e) => {
        if (e.type === 'notification') aliceReceived.push({ type: 'notification', title: e.event.title });
      },
    });
    try {
      await db.insert(schema.notifications).values({
        userId: aliceId,
        title: 'notif-direct',
        message: 'ping',
        priority: 'high',
      });
      await new Promise((r) => setTimeout(r, SSE_POLL_MS * 3 + 100));
      expect(aliceReceived).toContainEqual({ type: 'notification', title: 'notif-direct' });
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
    // The stream is intentionally long-lived, so `app.inject()` would
    // wait forever. Use a real HTTP request, verify SSE headers and the
    // initial `connected` event, then close the socket.
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.get(
          `${address}/events`,
          { headers: { accept: 'text/event-stream', cookie: aliceCookie } },
          (res) => resolve(res),
        );
        req.on('error', reject);
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');

      let body = '';
      response.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      response.destroy();

      expect(body).toContain('event: connected');
      expect(body).toContain('data: "{}"');
    } finally {
      await app.close();
      // rebuild and re-listen for subsequent tests that call app.inject()
      app = await buildApp();
    }
  });

  it('opens an SSE stream authenticated via ?token= (Electron path)', async () => {
    // EventSource can't send the Authorization header, so the desktop
    // client passes the bearer (MCP) token as a query param.
    const [row] = await db
      .select({ mcpToken: schema.users.mcpToken })
      .from(schema.users)
      .where(sql`${schema.users.email} = 'alice@api-test.local'`);
    if (!row) throw new Error('alice missing');

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.get(
          `${address}/events?token=${encodeURIComponent(row.mcpToken)}`,
          { headers: { accept: 'text/event-stream' } },
          (res) => resolve(res),
        );
        req.on('error', reject);
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      response.destroy();
    } finally {
      await app.close();
      app = await buildApp();
    }
  });

  it('rejects an SSE stream with a bogus ?token=', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.get(
          `${address}/events?token=bogus`,
          { headers: { accept: 'text/event-stream' } },
          (res) => resolve(res),
        );
        req.on('error', reject);
      });
      expect(response.statusCode).toBe(401);
      response.destroy();
    } finally {
      await app.close();
      app = await buildApp();
    }
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
