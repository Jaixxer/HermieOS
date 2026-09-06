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

const registry = new ToolRegistry();
registerObjectTools(registry);
registerRelationshipAndSubscriptionTools(registry);
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
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:15432/hermieos',
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

  it('get_subscription returns the full row for the owner', async () => {
    const created = await callTool<{ subscription: { id: string; name: string; target: string; instruction: string } }>(
      sessionA,
      userA.token,
      'create_subscription',
      {
        name: 'Paper Scout',
        target: 'arxiv:cs.AI',
        instruction: 'find me new papers on agent tool use',
        cadence: 'daily',
        source: 's',
      },
    );
    const got = await callTool<{ subscription: { id: string; name: string; target: string; instruction: string } }>(
      sessionA,
      userA.token,
      'get_subscription',
      { id: created.parsed.subscription.id },
    );
    expect(got.parsed.subscription.name).toBe('Paper Scout');
    expect(got.parsed.subscription.target).toBe('arxiv:cs.AI');
    expect(got.parsed.subscription.instruction).toBe('find me new papers on agent tool use');
  });

  it('get_subscription returns null for another user\'s subscription', async () => {
    const created = await callTool<{ subscription: { id: string } }>(
      sessionA,
      userA.token,
      'create_subscription',
      { name: 'Priv', target: 't', instruction: 'i', cadence: 'daily', source: 's' },
    );
    const got = await callTool<{ subscription: { id: string; name: string; target: string; instruction: string } | null }>(
      sessionB,
      userB.token,
      'get_subscription',
      { id: created.parsed.subscription.id },
    );
    expect(got.parsed.subscription).toBeNull();
  });

  it('run_subscription_now forces the scout due on the next tick', async () => {
    const created = await callTool<{ subscription: { id: string; nextRunAt: string; status: string } }>(
      sessionA,
      userA.token,
      'create_subscription',
      { name: 'Now', target: 't', instruction: 'i', cadence: 'daily', source: 's' },
    );
    const now = Date.now();
    await new Promise((r) => setTimeout(r, 10));
    const ran = await callTool<{ subscription: { nextRunAt: string; status: string } }>(
      sessionA,
      userA.token,
      'run_subscription_now',
      { id: created.parsed.subscription.id },
    );
    const next = new Date(ran.parsed.subscription.nextRunAt).getTime();
    expect(next).toBeLessThanOrEqual(now + 5_000);
    expect(ran.parsed.subscription.status).toBe('active');
  });

  it('run_subscription_now rejects another user\'s subscription', async () => {
    const created = await callTool<{ subscription: { id: string } }>(
      sessionA,
      userA.token,
      'create_subscription',
      { name: 'Priv2', target: 't', instruction: 'i', cadence: 'daily', source: 's' },
    );
    const ran = await callTool<{ subscription?: unknown }>(
      sessionB,
      userB.token,
      'run_subscription_now',
      { id: created.parsed.subscription.id },
    );
    expect(ran.isError).toBe(true);
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

// ---------------------------------------------------------------------------
// Phase 8: Graph — get_related_objects + traverse_graph
// ---------------------------------------------------------------------------

describe('get_related_objects', () => {
  it('returns all related objects in both directions', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'Node A', source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery', title: 'Node B', source: 's',
    });
    const c = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'note', title: 'Node C', source: 's',
    });
    // A → B (outbound)
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: b.parsed.object.id,
      kind: 'related_to', confidence: 0.8, reason: 'A relates to B', source: 'test',
    });
    // C → A (inbound from A's perspective)
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: c.parsed.object.id, toId: a.parsed.object.id,
      kind: 'derived_from', confidence: 0.6, reason: 'C derives from A', source: 'test',
    });

    const rel = await callTool<Array<{ id: string; title: string; direction: string; kind: string }>>(
      sessionA, userA.token, 'get_related_objects',
      { objectId: a.parsed.object.id, limit: 20 },
    );
    expect(rel.parsed.length).toBe(2);
    const titles = rel.parsed.map((r) => `${r.title}|${r.direction}|${r.kind}`).sort();
    expect(titles).toEqual(['Node B|outbound|related_to', 'Node C|inbound|derived_from']);
  });

  it('filters by kind', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'A', source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery', title: 'B', source: 's',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: b.parsed.object.id,
      kind: 'related_to', confidence: 0.8, reason: 'related', source: 'test',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: b.parsed.object.id,
      kind: 'cites', confidence: 0.5, reason: 'cites', source: 'test',
    });

    const rel = await callTool<Array<{ kind: string }>>(
      sessionA, userA.token, 'get_related_objects',
      { objectId: a.parsed.object.id, kind: 'cites', limit: 20 },
    );
    expect(rel.parsed.length).toBe(1);
    expect(rel.parsed[0]?.kind).toBe('cites');
  });

  it('filters by minimum confidence', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'A', source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery', title: 'B', source: 's',
    });
    const c = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'note', title: 'C', source: 's',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: b.parsed.object.id,
      kind: 'related_to', confidence: 0.9, reason: 'strong', source: 'test',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: c.parsed.object.id,
      kind: 'related_to', confidence: 0.2, reason: 'weak', source: 'test',
    });

    const rel = await callTool<Array<{ confidence: number }>>(
      sessionA, userA.token, 'get_related_objects',
      { objectId: a.parsed.object.id, minConfidence: 0.5, limit: 20 },
    );
    expect(rel.parsed.length).toBe(1);
  });

  it('filters by direction — inbound only', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'A', source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery', title: 'B', source: 's',
    });
    // B → A (inbound from A's perspective)
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: b.parsed.object.id, toId: a.parsed.object.id,
      kind: 'related_to', confidence: 0.8, reason: 'inbound', source: 'test',
    });
    // A → B (outbound)
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: b.parsed.object.id,
      kind: 'cites', confidence: 0.5, reason: 'outbound', source: 'test',
    });

    const rel = await callTool<Array<{ direction: string }>>(
      sessionA, userA.token, 'get_related_objects',
      { objectId: a.parsed.object.id, direction: 'inbound', limit: 20 },
    );
    expect(rel.parsed.length).toBe(1);
    expect(rel.parsed[0]?.direction).toBe('inbound');
  });

  it('returns empty array for object with no relationships', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'lonely', source: 's',
    });
    const rel = await callTool<Array<unknown>>(
      sessionA, userA.token, 'get_related_objects',
      { objectId: a.parsed.object.id, limit: 20 },
    );
    expect(rel.parsed).toEqual([]);
  });

  it('respects limit', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'hub', source: 's',
    });
    for (let i = 0; i < 5; i++) {
      const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
        type: 'discovery', title: `leaf-${i}`, source: 's',
      });
      await callTool(sessionA, userA.token, 'link_objects', {
        fromId: a.parsed.object.id, toId: b.parsed.object.id,
        kind: 'related_to', confidence: 0.8, reason: `link-${i}`, source: 'test',
      });
    }
    const rel = await callTool<Array<unknown>>(
      sessionA, userA.token, 'get_related_objects',
      { objectId: a.parsed.object.id, limit: 3 },
    );
    expect(rel.parsed.length).toBe(3);
  });
});

describe('traverse_graph', () => {
  it('returns 1-hop neighbours at depth 1', async () => {
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'Root', source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery', title: 'Child 1', source: 's',
    });
    const c = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'note', title: 'Child 2', source: 's',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: b.parsed.object.id,
      kind: 'related_to', confidence: 0.9, reason: 'edge 1', source: 'test',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: c.parsed.object.id,
      kind: 'derived_from', confidence: 0.7, reason: 'edge 2', source: 'test',
    });

    const result = await callTool<{
      startNode: { title: string };
      nodes: Array<{ title: string; depth: number; path: Array<{ kind: string }> }>;
      edgeCount: number;
    }>(
      sessionA, userA.token, 'traverse_graph',
      { objectId: a.parsed.object.id, maxDepth: 1, limit: 50 },
    );

    expect(result.parsed.startNode.title).toBe('Root');
    expect(result.parsed.nodes.length).toBe(2);
    expect(result.parsed.edgeCount).toBe(2);
    const titles = result.parsed.nodes.map((n) => n.title).sort();
    expect(titles).toEqual(['Child 1', 'Child 2']);
    for (const n of result.parsed.nodes) {
      expect(n.depth).toBe(1);
      expect(n.path.length).toBe(1);
    }
  });

  it('returns multi-hop graph with correct depths', async () => {
    // A → B → C → D  (chain of 3)
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'A', source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery', title: 'B', source: 's',
    });
    const c = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'note', title: 'C', source: 's',
    });
    const d = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'decision', title: 'D', source: 's',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: b.parsed.object.id,
      kind: 'related_to', confidence: 1, reason: 'A→B', source: 'test',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: b.parsed.object.id, toId: c.parsed.object.id,
      kind: 'related_to', confidence: 1, reason: 'B→C', source: 'test',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: c.parsed.object.id, toId: d.parsed.object.id,
      kind: 'related_to', confidence: 1, reason: 'C→D', source: 'test',
    });

    const result = await callTool<{
      nodes: Array<{ title: string; depth: number }>;
      edgeCount: number;
    }>(
      sessionA, userA.token, 'traverse_graph',
      { objectId: a.parsed.object.id, maxDepth: 3, limit: 50 },
    );

    expect(result.parsed.nodes.length).toBe(3);
    expect(result.parsed.edgeCount).toBe(3);
    const byDepth = new Map<number, string[]>();
    for (const n of result.parsed.nodes) {
      const arr = byDepth.get(n.depth) ?? [];
      arr.push(n.title);
      byDepth.set(n.depth, arr);
    }
    expect(byDepth.get(1)?.sort()).toEqual(['B']);
    expect(byDepth.get(2)?.sort()).toEqual(['C']);
    expect(byDepth.get(3)?.sort()).toEqual(['D']);
  });

  it('is cycle-safe: does not re-visit nodes', async () => {
    // A → B, B → A (mutual relationship)
    const a = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'Cycle A', source: 's',
    });
    const b = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'discovery', title: 'Cycle B', source: 's',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: a.parsed.object.id, toId: b.parsed.object.id,
      kind: 'related_to', confidence: 1, reason: 'A→B', source: 'test',
    });
    await callTool(sessionA, userA.token, 'link_objects', {
      fromId: b.parsed.object.id, toId: a.parsed.object.id,
      kind: 'related_to', confidence: 1, reason: 'B→A', source: 'test',
    });

    const result = await callTool<{ nodes: Array<{ title: string }>; edgeCount: number }>(
      sessionA, userA.token, 'traverse_graph',
      { objectId: a.parsed.object.id, maxDepth: 5, limit: 50 },
    );

    // Should only find B, not revisit A
    expect(result.parsed.nodes.length).toBe(1);
    expect(result.parsed.nodes[0]?.title).toBe('Cycle B');
  });

  it('respects maxDepth', async () => {
    // Create A → B → C → D (3 edges)
    const ids: string[] = [];
    const titles = ['A0', 'A1', 'A2', 'A3'];
    for (const t of titles) {
      const r = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
        type: 'research', title: t, source: 's',
      });
      ids.push(r.parsed.object.id);
    }
    for (let i = 0; i < 3; i++) {
      await callTool(sessionA, userA.token, 'link_objects', {
        fromId: ids[i]!, toId: ids[i + 1]!,
        kind: 'related_to', confidence: 1, reason: `chain`, source: 'test',
      });
    }

    const result = await callTool<{ nodes: Array<{ depth: number }>; edgeCount: number }>(
      sessionA, userA.token, 'traverse_graph',
      { objectId: ids[0]!, maxDepth: 1, limit: 50 },
    );

    expect(result.parsed.nodes.length).toBe(1);
    expect(result.parsed.edgeCount).toBe(1);
  });

  it('respects limit', async () => {
    // Hub connected to 5 leaf nodes
    const hub = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
      type: 'research', title: 'Hub', source: 's',
    });
    for (let i = 0; i < 5; i++) {
      const leaf = await callTool<{ object: { id: string } }>(sessionA, userA.token, 'create_object', {
        type: 'discovery', title: `Leaf ${i}`, source: 's',
      });
      await callTool(sessionA, userA.token, 'link_objects', {
        fromId: hub.parsed.object.id, toId: leaf.parsed.object.id,
        kind: 'related_to', confidence: 0.8, reason: `L${i}`, source: 'test',
      });
    }

    const result = await callTool<{ nodes: unknown[] }>(
      sessionA, userA.token, 'traverse_graph',
      { objectId: hub.parsed.object.id, maxDepth: 1, limit: 3 },
    );

    expect(result.parsed.nodes.length).toBe(3);
  });

  it('throws when start object is not found', async () => {
    const result = await callTool(sessionA, userA.token, 'traverse_graph', {
      objectId: '00000000-0000-0000-0000-000000000000',
      maxDepth: 1,
      limit: 50,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('not found');
  });
});
