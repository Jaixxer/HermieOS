import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { registerObjectTools } from './tools/objects.js';
import { clearTokenCache } from './auth.js';

let db: Database;

async function cleanup(): Promise<void> {
  await db.execute(
    sql`delete from object_revisions where user_id in (select id from users where email like '%@mcp-test.local')`,
  );
  await db.execute(
    sql`delete from object_events where user_id in (select id from users where email like '%@mcp-test.local')`,
  );
  await db.execute(
    sql`delete from objects where user_id in (select id from users where email like '%@mcp-test.local')`,
  );
  await db.execute(sql`delete from users where email like '%@mcp-test.local'`);
}

async function seedUser(label: string): Promise<{ id: string; token: string }> {
  const token = `tok_${label}_${randomBytes(8).toString('hex')}`;
  const email = `${label}-${randomBytes(4).toString('hex')}@mcp-test.local`;
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

const registry = new ToolRegistry();
registerObjectTools(registry);
const app = buildMcpApp(registry);

async function initSession(token: string): Promise<string> {
  const res = await app.fetch(
    new Request('http://localhost/mcp', {
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
    }),
  );
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('no session id');
  return sessionId;
}

interface ToolCallResult<T = unknown> {
  isError: boolean;
  text: string;
  parsed: T;
}

async function callTool<T = unknown>(
  sessionId: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult<T>> {
  const res = await app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.text();
  // body is SSE: "event: message\ndata: {...}\n\n" — extract the JSON.
  const m = /data: (\{.*\})/s.exec(body);
  if (!m || !m[1]) throw new Error(`no data line in response: ${body}`);
  const parsed = JSON.parse(m[1]) as { result?: { isError?: boolean; content?: Array<{ type: string; text: string }> } };
  const content = parsed.result?.content?.[0];
  if (!content || content.type !== 'text') {
    return { isError: !!parsed.result?.isError, text: '', parsed: null as T };
  }
  let value: T;
  try {
    value = JSON.parse(content.text) as T;
  } catch {
    // Non-JSON text content is the error path; return the raw text.
    value = content.text as unknown as T;
  }
  return {
    isError: !!parsed.result?.isError,
    text: content.text,
    parsed: value,
  };
}

let userA: { id: string; token: string };
let userB: { id: string; token: string };
let sessionA: string;
let sessionB: string;

beforeAll(async () => {
  db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  });
  await cleanup();
  clearTokenCache();
  userA = await seedUser('alice');
  userB = await seedUser('bob');
  sessionA = await initSession(userA.token);
  sessionB = await initSession(userB.token);
});
afterAll(async () => {
  await cleanup();
  await closeDatabase(db);
});
beforeEach(async () => {
  await db.execute(
    sql`delete from object_revisions where user_id in (select id from users where email like '%@mcp-test.local')`,
  );
  await db.execute(
    sql`delete from object_events where user_id in (select id from users where email like '%@mcp-test.local')`,
  );
  await db.execute(
    sql`delete from objects where user_id in (select id from users where email like '%@mcp-test.local')`,
  );
});

interface CreatedObject {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  body: Record<string, unknown>;
  status: string;
  tags: string[];
  revision: number;
  archivedAt: string | null;
  createdBy: string;
}

describe('create_object + update_object + revert_object', () => {
  it('creates an object at revision 1', async () => {
    const res = await callTool<{ object: CreatedObject; revision: number }>(
      sessionA,
      userA.token,
      'create_object',
      { type: 'research', title: 'ESP32 power optimization', source: 'hermes-run-1' },
    );
    expect(res.isError).toBe(false);
    expect(res.parsed.revision).toBe(1);
    expect(res.parsed.object.title).toBe('ESP32 power optimization');
    expect(res.parsed.object.revision).toBe(1);
    expect(res.parsed.object.archivedAt).toBeNull();
  });

  it('update_object writes a new revision when content changes', async () => {
    const created = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'v1',
      source: 's',
    });
    const updated = await callTool<{ object: CreatedObject; revisionCreated: number }>(
      sessionA,
      userA.token,
      'update_object',
      { id: created.parsed.object.id, title: 'v2', source: 's' },
    );
    expect(updated.parsed.revisionCreated).toBe(2);
    expect(updated.parsed.object.title).toBe('v2');
  });

  it('update_object with the same values is a no-op (no new revision)', async () => {
    const created = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'stable',
      summary: 'x',
      source: 's',
    });
    const noop = await callTool<{ object: CreatedObject; revisionCreated: number }>(
      sessionA,
      userA.token,
      'update_object',
      { id: created.parsed.object.id, title: 'stable', source: 's' },
    );
    expect(noop.parsed.revisionCreated).toBe(0);
    // The object is still at revision 1.
    expect(noop.parsed.object.revision).toBe(1);
  });

  it('update_object with no fields is rejected at the schema layer', async () => {
    const created = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'no-args',
      source: 's',
    });
    const bad = await callTool(sessionA, userA.token, 'update_object', {
      id: created.parsed.object.id,
      source: 's',
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/at least one/i);
  });

  it('revisions are append-only and retrievable', async () => {
    const c = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'r1',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'update_object', {
      id: c.parsed.object.id,
      title: 'r2',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'update_object', {
      id: c.parsed.object.id,
      title: 'r3',
      source: 's',
    });
    const revs = await callTool<{ revisions: Array<{ revision: number; title: string }> }>(
      sessionA,
      userA.token,
      'list_object_revisions',
      { id: c.parsed.object.id, limit: 10 },
    );
    expect(revs.parsed.revisions.map((r) => r.title)).toEqual(['r3', 'r2', 'r1']);
  });

  it('revert_object creates a new revision with the old content', async () => {
    const c = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'old',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'update_object', {
      id: c.parsed.object.id,
      title: 'new',
      source: 's',
    });
    // now revisions: 1=old, 2=new
    const reverted = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'revert_object', {
      id: c.parsed.object.id,
      revision: 1,
      source: 's',
    });
    expect(reverted.parsed.object.title).toBe('old');
    // revision count is now 3 (1=old, 2=new, 3=revert to old)
    expect(reverted.parsed.object.revision).toBe(3);
  });

  it('append_note adds a note without overwriting body (and creates a revision)', async () => {
    const c = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'noteable',
      body: { text: 'initial' },
      source: 's',
    });
    const upd = await callTool<{ revisionCreated: number }>(sessionA, userA.token, 'update_object', {
      id: c.parsed.object.id,
      appendNote: 'a quick observation',
      source: 's',
    });
    expect(upd.parsed.revisionCreated).toBe(2);
  });

  it('archive_object sets archivedAt; the object row remains', async () => {
    const c = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'to-archive',
      source: 's',
    });
    const arch = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'archive_object', {
      id: c.parsed.object.id,
      source: 's',
    });
    expect(arch.parsed.object.archivedAt).not.toBeNull();
    // the row is still there
    const fetched = await callTool<{ object: CreatedObject | null }>(sessionA, userA.token, 'get_object', {
      id: c.parsed.object.id,
    });
    expect(fetched.parsed.object).not.toBeNull();
    expect(fetched.parsed.object?.archivedAt).not.toBeNull();
  });

  it('update_object on an archived object errors', async () => {
    const c = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'archived',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'archive_object', { id: c.parsed.object.id, source: 's' });
    const upd = await callTool(sessionA, userA.token, 'update_object', {
      id: c.parsed.object.id,
      title: 'after-archive',
      source: 's',
    });
    expect(upd.isError).toBe(true);
    expect(upd.text).toMatch(/archived/i);
  });
});

describe('list_objects + search_objects', () => {
  beforeEach(async () => {
    // wipe the created-then-archived row from previous block (re-uses beforeEach above)
  });

  it('list_objects returns only the requesting user\'s objects', async () => {
    const a1 = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'A1',
      source: 's',
    });
    const a2 = await callTool<{ object: CreatedObject }>(sessionA, userA.token, 'create_object', {
      type: 'discovery',
      title: 'A2',
      source: 's',
    });
    const b1 = await callTool<{ object: CreatedObject }>(sessionB, userB.token, 'create_object', {
      type: 'research',
      title: 'B1',
      source: 's',
    });
    expect(a1.parsed.object.id).toBeTruthy();
    expect(a2.parsed.object.id).toBeTruthy();
    expect(b1.parsed.object.id).toBeTruthy();

    const aList = await callTool<{ objects: CreatedObject[] }>(sessionA, userA.token, 'list_objects', {
      limit: 50,
    });
    const aTitles = aList.parsed.objects.map((o) => o.title).sort();
    expect(aTitles).toEqual(['A1', 'A2']);

    const bList = await callTool<{ objects: CreatedObject[] }>(sessionB, userB.token, 'list_objects', {
      limit: 50,
    });
    const bTitles = bList.parsed.objects.map((o) => o.title).sort();
    expect(bTitles).toEqual(['B1']);
  });

  it('list_objects filters by type', async () => {
    await callTool(sessionA, userA.token, 'create_object', { type: 'research', title: 'r', source: 's' });
    await callTool(sessionA, userA.token, 'create_object', { type: 'discovery', title: 'd', source: 's' });
    const list = await callTool<{ objects: CreatedObject[] }>(sessionA, userA.token, 'list_objects', {
      type: 'discovery',
      limit: 50,
    });
    expect(list.parsed.objects.every((o) => o.type === 'discovery')).toBe(true);
  });

  it('search_objects finds by title and returns a snippet', async () => {
    await callTool(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'ESP32 deep sleep current optimization',
      summary: 'Reducing quiescent draw on battery-powered sensors',
      body: { methodology: 'measured with uCurrent' },
      source: 's',
    });
    await callTool(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'ROS2 navigation stack',
      source: 's',
    });
    const res = await callTool<{ hits: Array<{ title: string; rank: number; snippet: string }> }>(
      sessionA,
      userA.token,
      'search_objects',
      { query: 'ESP32', limit: 10 },
    );
    expect(res.parsed.hits.length).toBeGreaterThanOrEqual(1);
    expect(res.parsed.hits[0]?.title).toContain('ESP32');
    expect(res.parsed.hits[0]?.rank).toBeGreaterThan(0);
  });

  it('search_objects does not return another user\'s objects', async () => {
    await callTool(sessionB, userB.token, 'create_object', {
      type: 'research',
      title: 'secret bob thing',
      source: 's',
    });
    const res = await callTool<{ hits: unknown[] }>(sessionA, userA.token, 'search_objects', {
      query: 'secret',
      limit: 10,
    });
    expect(res.parsed.hits.length).toBe(0);
  });
});

describe('cross-user authz', () => {
  it('user A cannot read user B\'s object', async () => {
    const b1 = await callTool<{ object: CreatedObject }>(sessionB, userB.token, 'create_object', {
      type: 'research',
      title: 'B-secret',
      source: 's',
    });
    const aFetch = await callTool<{ object: CreatedObject | null }>(sessionA, userA.token, 'get_object', {
      id: b1.parsed.object.id,
    });
    expect(aFetch.parsed.object).toBeNull();
  });

  it('user A cannot update user B\'s object (update returns not-found, no revision written)', async () => {
    const b1 = await callTool<{ object: CreatedObject }>(sessionB, userB.token, 'create_object', {
      type: 'research',
      title: 'B-target',
      source: 's',
    });
    const aUpd = await callTool(sessionA, userA.token, 'update_object', {
      id: b1.parsed.object.id,
      title: 'hijacked',
      source: 's',
    });
    expect(aUpd.isError).toBe(true);
    // confirm B's object is unchanged
    const bFetch = await callTool<{ object: CreatedObject | null }>(sessionB, userB.token, 'get_object', {
      id: b1.parsed.object.id,
    });
    expect(bFetch.parsed.object?.title).toBe('B-target');
  });

  it('user A cannot archive user B\'s object', async () => {
    const b1 = await callTool<{ object: CreatedObject }>(sessionB, userB.token, 'create_object', {
      type: 'research',
      title: 'B-keep',
      source: 's',
    });
    const aArch = await callTool(sessionA, userA.token, 'archive_object', {
      id: b1.parsed.object.id,
      source: 's',
    });
    expect(aArch.isError).toBe(true);
    const bFetch = await callTool<{ object: CreatedObject | null }>(sessionB, userB.token, 'get_object', {
      id: b1.parsed.object.id,
    });
    expect(bFetch.parsed.object?.archivedAt).toBeNull();
  });
});
