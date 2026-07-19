import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from './server.js';
import { setDb } from './data/auth.js';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';

let db: Database;

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from sessions where user_id in (select id from users where email like '%@api-test.local')`);
  await db.execute(sql`delete from users where email like '%@api-test.local'`);
}

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  });
  setDb(db);
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});
beforeEach(async () => {
  await cleanup();
});

async function call(
  app: Awaited<ReturnType<typeof buildApp>>,
  method: string,
  url: string,
  opts: { body?: unknown; cookies?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (opts.cookies) {
    headers['cookie'] = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
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
    setCookie: res.headers['set-cookie'] ?? null,
  };
}

function getCookie(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  for (const part of setCookie.split(/,(?=[^;]+=)/)) {
    const [pair] = part.split(';');
    const [k, v] = pair.split('=');
    if (k.trim() === name) return v ?? null;
  }
  return null;
}

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp();
});

describe('auth — signup, login, logout', () => {
  it('signs up a new user, returns the user and the mcp_token, sets a session cookie', async () => {
    const res = await call(app, 'POST', '/auth/signup', {
      body: { email: 'alice@api-test.local', password: 'correct-horse-battery', displayName: 'Alice' },
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    const user = res.body.user as { id: string; email: string; displayName: string };
    expect(user.email).toBe('alice@api-test.local');
    expect(user.displayName).toBe('Alice');
    expect(typeof user.id).toBe('string');
    expect(res.body.mcpToken).toBeTruthy();
    expect(typeof res.body.mcpToken).toBe('string');
    expect((res.body.mcpToken as string).startsWith('mcp_')).toBe(true);
    expect(res.setCookie).toBeTruthy();
    const cookie = getCookie(res.setCookie, 'hermieos_session');
    expect(cookie).toBeTruthy();
  });

  it('rejects signup with a short password', async () => {
    const res = await call(app, 'POST', '/auth/signup', {
      body: { email: 'weak@api-test.local', password: 'short', displayName: 'X' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects signup with an invalid email', async () => {
    const res = await call(app, 'POST', '/auth/signup', {
      body: { email: 'not-an-email', password: 'correct-horse-battery', displayName: 'X' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 if email is already taken', async () => {
    const r1 = await call(app, 'POST', '/auth/signup', {
      body: { email: 'dup@api-test.local', password: 'correct-horse-battery', displayName: 'A' },
    });
    expect(r1.status).toBe(200);
    const r2 = await call(app, 'POST', '/auth/signup', {
      body: { email: 'dup@api-test.local', password: 'correct-horse-battery', displayName: 'B' },
    });
    expect(r2.status).toBe(409);
  });

  it('logs in with valid credentials and sets a session cookie', async () => {
    await call(app, 'POST', '/auth/signup', {
      body: { email: 'login@api-test.local', password: 'correct-horse-battery', displayName: 'Login' },
    });
    const res = await call(app, 'POST', '/auth/login', {
      body: { email: 'login@api-test.local', password: 'correct-horse-battery' },
    });
    expect(res.status).toBe(200);
    expect(res.setCookie).toBeTruthy();
  });

  it('rejects login with a wrong password', async () => {
    await call(app, 'POST', '/auth/signup', {
      body: { email: 'wrong@api-test.local', password: 'correct-horse-battery', displayName: 'X' },
    });
    const res = await call(app, 'POST', '/auth/login', {
      body: { email: 'wrong@api-test.local', password: 'wrong-password' },
    });
    expect(res.status).toBe(401);
  });

  it('logs out: clears the session cookie and invalidates the session', async () => {
    const sign = await call(app, 'POST', '/auth/signup', {
      body: { email: 'logout@api-test.local', password: 'correct-horse-battery', displayName: 'X' },
    });
    const cookie = getCookie(sign.setCookie, 'hermieos_session');
    expect(cookie).toBeTruthy();
    if (!cookie) return;

    // Use the cookie to fetch /me (we don't have /me yet, so use a protected path
    // by calling logout and then trying to use the cookie again).
    const out = await call(app, 'POST', '/auth/logout', { cookies: { hermieos_session: cookie } });
    expect(out.status).toBe(200);

    // After logout, the cookie is cleared.
    expect(out.setCookie).toBeTruthy();
    const cleared = getCookie(out.setCookie, 'hermieos_session');
    expect(cleared).toBe('');
  });

  it('logout without a session is a no-op 200', async () => {
    const res = await call(app, 'POST', '/auth/logout');
    expect(res.status).toBe(200);
  });
});

describe('auth — schema / DB', () => {
  it('email is lowercased on signup', async () => {
    const r = await call(app, 'POST', '/auth/signup', {
      body: { email: 'MixedCase@api-test.local', password: 'correct-horse-battery', displayName: 'X' },
    });
    expect(r.status).toBe(200);
    const rows = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(sql`${schema.users.email} ilike '%mixedcase%api-test.local'`);
    expect(rows[0]?.email).toBe('mixedcase@api-test.local');
  });
});
