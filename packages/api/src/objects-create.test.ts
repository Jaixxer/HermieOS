import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from './server.js';
import { createDatabase, closeDatabase } from '@hermieos/db';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';

const URL = process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos';
let db: ReturnType<typeof createDatabase>;

async function signup(): Promise<{ userId: string; cookie: string }> {
  const email = `obj-${randomBytes(4).toString('hex')}@api-test.local`;
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password: 'correct-horse-battery', displayName: 'Obj' },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'] as string | undefined;
  if (!setCookie) throw new Error('no cookie');
  const body = res.json();
  return { userId: body.user.id, cookie: setCookie.split(';')[0] ?? '' };
}

let app: FastifyInstance;

describe('POST /objects', () => {
  beforeEach(async () => {
    db = createDatabase({ url: URL });
    await db.execute(sql`delete from objects where user_id in (select id from users where email like 'obj-%@api-test.local')`);
    await db.execute(sql`delete from users where email like 'obj-%@api-test.local'`);
    app = await buildApp();
  });

  afterAll(async () => {
    await db.execute(sql`delete from objects where user_id in (select id from users where email like 'obj-%@api-test.local')`);
    await db.execute(sql`delete from users where email like 'obj-%@api-test.local'`);
    await closeDatabase(db);
  });

  it('creates an object and returns it', async () => {
    const { cookie } = await signup();
    const res = await app.inject({
      method: 'POST',
      url: '/objects',
      headers: { cookie },
      payload: {
        type: 'research',
        title: 'e2e-Project',
        summary: 'a thing',
        body: { note: 'hi' },
        tags: ['esp32', 'demo'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.object.title).toBe('e2e-Project');
    expect(body.object.tags).toEqual(['esp32', 'demo']);
    expect(body.object.revision).toBe(1);
  });

  it('rejects unknown type', async () => {
    const { cookie } = await signup();
    const res = await app.inject({
      method: 'POST',
      url: '/objects',
      headers: { cookie },
      payload: { type: 'bogus', title: 'x' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('invalid_input');
    expect(body.requestId).toBeTruthy();
  });

  it('rejects empty title', async () => {
    const { cookie } = await signup();
    const res = await app.inject({
      method: 'POST',
      url: '/objects',
      headers: { cookie },
      payload: { type: 'note', title: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/objects',
      payload: { type: 'note', title: 'x' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.requestId).toBeTruthy();
  });

  it('the created object is readable via GET /objects/:id', async () => {
    const { cookie } = await signup();
    const create = await app.inject({
      method: 'POST',
      url: '/objects',
      headers: { cookie },
      payload: { type: 'discovery', title: 'chain' },
    });
    const id = create.json().object.id;
    const get = await app.inject({ method: 'GET', url: `/objects/${id}`, headers: { cookie } });
    expect(get.statusCode).toBe(200);
    expect(get.json().object.title).toBe('chain');
  });
});
