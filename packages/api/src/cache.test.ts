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

async function call(
  method: 'GET' | 'POST',
  url: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; cache: string | null }> {
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
  return {
    status: res.statusCode,
    body,
    cache: (res.headers['x-cache'] as string | undefined) ?? null,
  };
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
});

describe('cache: GET /feed', () => {
  it('first call is a miss, second is a hit', async () => {
    const r1 = await call('GET', '/feed', { cookie: aliceCookie });
    expect(r1.status).toBe(200);
    expect(r1.cache).toBe('miss');

    const r2 = await call('GET', '/feed', { cookie: aliceCookie });
    expect(r2.status).toBe(200);
    expect(r2.cache).toBe('hit');
  });

  it('POST /feed/mark-read invalidates the cache for that user', async () => {
    await call('GET', '/feed', { cookie: aliceCookie }); // miss
    const r2 = await call('GET', '/feed', { cookie: aliceCookie }); // hit
    expect(r2.cache).toBe('hit');

    await call('POST', '/feed/mark-read', {
      body: { upTo: new Date().toISOString() },
      cookie: aliceCookie,
    });

    const r3 = await call('GET', '/feed', { cookie: aliceCookie }); // miss again
    expect(r3.cache).toBe('miss');
  });
});

describe('cache: GET /search', () => {
  beforeEach(async () => {
    // Seed an object so search has something to find.
    const [obj] = await db
      .insert(schema.objects)
      .values({
        userId: aliceId,
        type: 'research',
        title: 'cache-test-ESP32',
        body: {},
        createdBy: 'user',
      })
      .returning();
    if (!obj) throw new Error('seed failed');
  });

  it('first call is a miss, second is a hit', async () => {
    const r1 = await call('GET', '/search?q=cache-test-ESP32', { cookie: aliceCookie });
    expect(r1.status).toBe(200);
    expect(r1.cache).toBe('miss');

    const r2 = await call('GET', '/search?q=cache-test-ESP32', { cookie: aliceCookie });
    expect(r2.status).toBe(200);
    expect(r2.cache).toBe('hit');
  });

  it('different queries are independent cache entries', async () => {
    const r1 = await call('GET', '/search?q=cache-test-ESP32', { cookie: aliceCookie });
    expect(r1.cache).toBe('miss');
    const r2 = await call('GET', '/search?q=cache-test-ESP32', { cookie: aliceCookie });
    expect(r2.cache).toBe('hit');
    const r3 = await call('GET', '/search?q=other-query', { cookie: aliceCookie });
    expect(r3.cache).toBe('miss');
  });
});
