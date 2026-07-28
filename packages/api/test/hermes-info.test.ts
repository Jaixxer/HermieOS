import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/server.js';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;

async function cleanup(): Promise<void> {
  await db.execute(
    sql`delete from sessions where user_id in (select id from users where email like '%@hermes-info-test.local')`,
  );
  await db.execute(sql`delete from users where email like '%@hermes-info-test.local'`);
}

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  });
  app = await buildApp();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});
beforeEach(async () => {
  await cleanup();
});

async function inject(
  method: 'GET' | 'POST',
  url: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
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
    setCookie: (res.headers['set-cookie'] as string | undefined) ?? null,
  };
}

function getCookie(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  for (const part of setCookie.split(/,(?=[^;]+=)/)) {
    const pair = part.split(';')[0];
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim();
    if (k === name) return pair.slice(eq + 1) ?? null;
  }
  return null;
}

describe('GET /me/hermes-info', () => {
  it('returns 401 when no session cookie is provided', async () => {
    const res = await inject('GET', '/me/hermes-info');
    expect(res.status).toBe(401);
  });

  it('returns baseUrl + mcpToken when authenticated', async () => {
    const signup = await inject('POST', '/auth/signup', {
      body: {
        email: 'mert@hermes-info-test.local',
        password: 'correct-horse-battery',
        displayName: 'Mert',
      },
    });
    expect(signup.status).toBe(200);
    const session = getCookie(signup.setCookie, 'hermieos_session');
    expect(session).toBeTruthy();
    const info = await inject('GET', '/me/hermes-info', { cookie: `hermieos_session=${session}` });
    expect(info.status).toBe(200);
    expect(typeof info.body.baseUrl).toBe('string');
    expect((info.body.baseUrl as string).length).toBeGreaterThan(0);
    expect(typeof info.body.token).toBe('string');
    expect((info.body.token as string).startsWith('mcp_')).toBe(true);
  });

  it('rejects an invalid session cookie', async () => {
    const res = await inject('GET', '/me/hermes-info', { cookie: 'hermieos_session=invalid_value' });
    expect(res.status).toBe(401);
  });
});
