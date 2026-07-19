import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDatabase, schema, closeDatabase, type Database } from '@hermieos/db';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildMcpApp } from './server.js';
import { ToolRegistry } from './registry.js';
import { registerObjectTools } from './tools/objects.js';
import { registerRelationshipAndSubscriptionTools } from './tools/misc.js';
import { clearTokenCache } from './auth.js';

let db: Database;

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from object_relationships where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from feedback where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from object_revisions where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from object_events where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from objects where user_id in (select id from users where email like '%@mcp-test.local')`);
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

let app: Hono;
const registry = new ToolRegistry();
registerObjectTools(registry);
registerRelationshipAndSubscriptionTools(registry);
app = buildMcpApp(registry);

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
    value = content.text as unknown as T;
  }
  return { isError: !!parsed.result?.isError, text: content.text, parsed: value };
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
  await db.execute(sql`delete from object_relationships where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from feed_events where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from feedback where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from subscriptions where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from object_revisions where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from object_events where user_id in (select id from users where email like '%@mcp-test.local')`);
  await db.execute(sql`delete from objects where user_id in (select id from users where email like '%@mcp-test.local')`);
});

describe('link_objects / unlink_objects', () => {
  it('creates an edge with confidence + reason', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'project',
      title: 'AI Hardware Lab',
      source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery',
      title: 'ESP32 deep sleep current',
      source: 's',
    });
    const res = await callTool<{ relationship: { confidence: number; reason: string } }>(
      sessionA,
      userA.token,
      'link_objects',
      {
        fromId: a.parsed.object.id,
        toId: b.parsed.object.id,
        kind: 'related_to',
        confidence: 0.85,
        reason: 'discovery informs the project',
        source: 'hermes-run-1',
      },
    );
    expect(res.parsed.relationship.confidence).toBe(0.85);
    expect(res.parsed.relationship.reason).toMatch(/discovery/);
  });

  it('re-linking the same (from, to, kind) updates confidence and reason', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'project',
      title: 'A',
      source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery',
      title: 'B',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id,
      toId: b.parsed.object.id,
      kind: 'related_to',
      confidence: 0.4,
      reason: 'maybe',
      source: 's',
    });
    const updated = await callTool<{ relationship: { confidence: number; reason: string } }>(
      sessionA,
      userA.token,
      'link_objects',
      {
        fromId: a.parsed.object.id,
        toId: b.parsed.object.id,
        kind: 'related_to',
        confidence: 0.9,
        reason: 'confirmed',
        source: 's',
      },
    );
    expect(updated.parsed.relationship.confidence).toBe(0.9);
    expect(updated.parsed.relationship.reason).toBe('confirmed');
  });

  it('rejects self-link with a clear error', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'project',
      title: 'A',
      source: 's',
    });
    const r = await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id,
      toId: a.parsed.object.id,
      kind: 'related_to',
      confidence: 0.5,
      reason: 'self',
      source: 's',
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/itself/i);
  });

  it('rejects links across users', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'project',
      title: 'A',
      source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionB, userB.token, 'create_object', {
      type: 'discovery',
      title: 'B-secret',
      source: 's',
    });
    const r = await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id,
      toId: b.parsed.object.id,
      kind: 'related_to',
      confidence: 0.5,
      reason: 'cross',
      source: 's',
    });
    expect(r.isError).toBe(true);
  });
});

describe('subscriptions', () => {
  it('creates a daily subscription with a next_run_at in the future', async () => {
    const before = Date.now();
    const res = await callTool<{ subscription: { cadence: string; nextRunAt: string } }>(
      sessionA,
      userA.token,
      'create_subscription',
      {
        name: 'Watch Home Assistant',
        target: 'home-assistant.io',
        instruction: 'check the changelog',
        cadence: 'daily',
        source: 's',
      },
    );
    const next = new Date(res.parsed.subscription.nextRunAt).getTime();
    expect(next).toBeGreaterThan(before);
    expect(next - before).toBeGreaterThan(20 * 60 * 60_000); // >20h
  });

  it('updating cadence resets next_run_at', async () => {
    const created = await callTool<{ subscription: { id: string; nextRunAt: string } }>(
      sessionA,
      userA.token,
      'create_subscription',
      {
        name: 'X',
        target: 't',
        instruction: 'i',
        cadence: 'daily',
        source: 's',
      },
    );
    const oldNext = new Date(created.parsed.subscription.nextRunAt).getTime();
    await new Promise((r) => setTimeout(r, 50));
    const updated = await callTool<{ subscription: { nextRunAt: string } }>(
      sessionA,
      userA.token,
      'update_subscription',
      { id: created.parsed.subscription.id, cadence: 'hourly', source: 's' },
    );
    const newNext = new Date(updated.parsed.subscription.nextRunAt).getTime();
    expect(newNext).toBeLessThan(oldNext);
  });

  it('archive sets status to archived and the row stays', async () => {
    const created = await callTool<{ subscription: { id: string; status: string } }>(
      sessionA,
      userA.token,
      'create_subscription',
      {
        name: 'A',
        target: 't',
        instruction: 'i',
        cadence: 'daily',
        source: 's',
      },
    );
    const arch = await callTool<{ subscription: { status: string } }>(
      sessionA,
      userA.token,
      'archive_subscription',
      { id: created.parsed.subscription.id, source: 's' },
    );
    expect(arch.parsed.subscription.status).toBe('archived');
  });
});

describe('record_feedback', () => {
  it('records a like, ignores, archive, and suggest', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'fb',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'record_feedback', {
      objectId: a.parsed.object.id,
      kind: 'like',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'record_feedback', {
      objectId: a.parsed.object.id,
      kind: 'ignore',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'record_feedback', {
      objectId: a.parsed.object.id,
      kind: 'suggest',
      payload: { text: 'add ESP32 details' },
      source: 's',
    });
    // confirm rows
    const rows = await db
      .select()
      .from(schema.feedback)
      .where(sql`${schema.feedback.objectId} = ${a.parsed.object.id}`);
    expect(rows.length).toBe(3);
  });

  it("'archive' feedback also archives the object", async () => {
    const a = await callTool<{ object: { id: string; archivedAt: string | null } }>(
      sessionA,
      userA.token,
      'create_object',
      { type: 'discovery', title: 'tbr', source: 's' },
    );
    expect(a.parsed.object.archivedAt).toBeNull();
    await callTool(sessionA, userA.token, 'record_feedback', {
      objectId: a.parsed.object.id,
      kind: 'archive',
      source: 's',
    });
    const fetched = await callTool<{ object: { archivedAt: string | null } | null }>(
      sessionA,
      userA.token,
      'get_object',
      { id: a.parsed.object.id },
    );
    expect(fetched.parsed.object?.archivedAt).not.toBeNull();
  });
});

describe('get_recent_activity + mark_feed_read', () => {
  it('create_object emits a feed_event of kind object_created', async () => {
    const before = await callTool<{ events: Array<{ id: string; kind: string }> }>(
      sessionA,
      userA.token,
      'get_recent_activity',
      { limit: 10 },
    );
    await callTool(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'feed-test',
      source: 's',
    });
    const after = await callTool<{ events: Array<{ id: string; kind: string }> }>(
      sessionA,
      userA.token,
      'get_recent_activity',
      { limit: 10 },
    );
    expect(after.parsed.events.length).toBe(before.parsed.events.length + 1);
    expect(after.parsed.events[0]?.kind).toBe('object_created');
  });

  it('mark_feed_read sets readAt on events older than up_to', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'readme',
      source: 's',
    });
    void a;
    await new Promise((r) => setTimeout(r, 50));
    const upTo = new Date().toISOString();
    await callTool(sessionA, userA.token, 'mark_feed_read', { upTo });
    const after = await callTool<{ events: Array<{ readAt: string | null }> }>(
      sessionA,
      userA.token,
      'get_recent_activity',
      { limit: 10 },
    );
    const stillUnread = after.parsed.events.filter((e) => e.readAt === null);
    expect(stillUnread.length).toBe(0);
  });
});

describe('get_object_timeline', () => {
  it('returns the event log for an object in reverse chronological order', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research',
      title: 'tl',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'update_object', {
      id: a.parsed.object.id,
      title: 'tl-v2',
      source: 's',
    });
    await callTool(sessionA, userA.token, 'archive_object', {
      id: a.parsed.object.id,
      source: 's',
    });
    const tl = await callTool<{ events: Array<{ kind: string }> }>(
      sessionA,
      userA.token,
      'get_object_timeline',
      { id: a.parsed.object.id, limit: 10 },
    );
    const kinds = tl.parsed.events.map((e) => e.kind);
    expect(kinds).toEqual(['archived', 'updated', 'created']);
  });
});
