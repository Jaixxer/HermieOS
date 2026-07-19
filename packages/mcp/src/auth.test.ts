import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, schema, closeDatabase } from '@hermieos/db';
import { randomBytes } from 'node:crypto';
import { resolveBearer, clearTokenCache } from './auth.js';
import { Hono } from 'hono';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { z } from 'zod';

const db = createDatabase({ url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos' });

async function seedUser(label: string): Promise<{ id: string; token: string }> {
  const token = `tok_${label}_${randomBytes(8).toString('hex')}`;
  const email = `${label}-${randomBytes(4).toString('hex')}@test.local`;
  const [row] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: 'x',
      displayName: label,
      mcpToken: token,
    })
    .returning({ id: schema.users.id, token: schema.users.mcpToken });
  if (!row) throw new Error('failed to seed user');
  return { id: row.id, token: row.token };
}

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from users where email like '%@test.local'`);
}

const createdUsers: string[] = [];
beforeAll(async () => {
  await cleanup();
  clearTokenCache();
});
afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});

describe('mcp auth', () => {
  it('returns null for a missing Authorization header', async () => {
    expect(await resolveBearer(undefined)).toBeNull();
    expect(await resolveBearer(null)).toBeNull();
    expect(await resolveBearer('')).toBeNull();
  });

  it('returns null for a malformed header', async () => {
    expect(await resolveBearer('foo')).toBeNull();
    expect(await resolveBearer('Basic abc')).toBeNull();
    expect(await resolveBearer('Bearer ')).toBeNull();
  });

  it('returns null for a token that does not exist', async () => {
    expect(await resolveBearer('Bearer nope')).toBeNull();
  });

  it('returns the user for a valid token', async () => {
    const { id, token } = await seedUser('alice');
    createdUsers.push(id);
    const ctx = await resolveBearer(`Bearer ${token}`);
    expect(ctx).toEqual({ userId: id });
  });

  it('rejects an archived user', async () => {
    const { id, token } = await seedUser('archive-me');
    createdUsers.push(id);
    await db
      .update(schema.users)
      .set({ archivedAt: new Date() })
      .where(sql`${schema.users.id} = ${id}`);
    clearTokenCache(); // so we re-read from DB
    expect(await resolveBearer(`Bearer ${token}`)).toBeNull();
  });
});

describe('mcp app', () => {
  const noopRegistry = new ToolRegistry();
  noopRegistry.register({
    name: 'noop_echo',
    description: 'Echo back the input.',
    schema: z.object({ value: z.string() }),
    handler: async (ctx, args) => {
      const a = args as { value: string };
      return { user: ctx.userId, value: a.value };
    },
  });
  const app: Hono = buildMcpApp(noopRegistry);

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    return app.fetch(new Request(`http://localhost${url}`, init));
  }

  it('GET /healthz returns 200 with no auth', async () => {
    const res = await call('/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('hermieos-mcp');
  });

  it('POST /mcp without a bearer token returns 401', async () => {
    const res = await call('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'noop_echo', params: { value: 'x' } }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('POST /mcp without initialize and no session returns 400', async () => {
    const { id, token } = await seedUser('bob');
    createdUsers.push(id);
    clearTokenCache();
    const res = await call('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'noop_echo', params: { value: 'x' } }),
    });
    expect(res.status).toBe(400);
  });

  it('end-to-end: initialize, list tools, call noop_echo', async () => {
    const { id, token } = await seedUser('carol');
    createdUsers.push(id);
    clearTokenCache();

    // initialize
    const initRes = await call('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    if (!sessionId) throw new Error('no session id');

    // initialized notification
    await call('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // call noop_echo
    const toolRes = await call('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'noop_echo', arguments: { value: 'hello' } },
      }),
    });
    expect(toolRes.status).toBe(200);
    const text = await toolRes.text();
    // body is SSE if accept includes text/event-stream
    expect(text).toContain('hello');
  });

  it('a session id from one user cannot be used by another user', async () => {
    const u1 = await seedUser('eve1');
    const u2 = await seedUser('eve2');
    createdUsers.push(u1.id, u2.id);
    clearTokenCache();

    const initRes = await call('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${u1.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      }),
    });
    const sessionId = initRes.headers.get('mcp-session-id');
    if (!sessionId) throw new Error('no session id');

    const attack = await call('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${u2.token}`,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'noop_echo', arguments: { value: 'stolen' } },
      }),
    });
    expect(attack.status).toBe(403);
  });
});
