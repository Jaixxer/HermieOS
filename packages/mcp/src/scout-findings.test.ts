import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { randomBytes, randomUUID } from 'node:crypto';
import { getDb } from './data/db.js';
import { listScoutFindings } from './data/objects.js';

let db: ReturnType<typeof getDb>;

async function cleanup(): Promise<void> {
  await db.execute(
    sql`delete from object_revisions where user_id in (select id from users where email like '%@findings-test.local')`,
  );
  await db.execute(
    sql`delete from objects where user_id in (select id from users where email like '%@findings-test.local')`,
  );
  await db.execute(
    sql`delete from subscriptions where user_id in (select id from users where email like '%@findings-test.local')`,
  );
  await db.execute(
    sql`delete from users where email like '%@findings-test.local'`,
  );
}

async function seedUser(label: string): Promise<{ id: string }> {
  const email = `${label}-${randomBytes(4).toString('hex')}@findings-test.local`;
  const [row] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'x', displayName: label, mcpToken: randomUUID() })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('failed to seed user');
  return { id: row.id };
}

async function seedScout(userId: string, target: string): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      userId,
      name: 'test scout',
      target,
      instruction: 'find stuff',
      cadence: 'daily',
    })
    .returning({ id: schema.subscriptions.id });
  if (!row) throw new Error('failed to seed subscription');
  return { id: row.id };
}

type ObjectType = 'project' | 'research' | 'discovery' | 'decision' | 'opportunity' | 'learning_path' | 'note' | 'collection';

async function seedObject(
  userId: string,
  type: ObjectType,
  title: string,
  body: Record<string, unknown>,
): Promise<string> {
  const [row] = await db
    .insert(schema.objects)
    .values({
      userId,
      type,
      title,
      body,
      tags: [],
      createdBy: 'system',
    })
    .returning({ id: schema.objects.id });
  if (!row) throw new Error('failed to seed object');
  return row.id;
}

async function seedOpportunity(
  userId: string,
  title: string,
  body: Record<string, unknown>,
): Promise<string> {
  return seedObject(userId, 'opportunity', title, body);
}

beforeAll(async () => {
  db = getDb();
});

afterAll(async () => {
  await cleanup();
  await db.$client.end();
});

beforeEach(async () => {
  await cleanup();
});

describe('listScoutFindings', () => {
  it('returns opportunities linked via body.subscriptionId', async () => {
    const u = await seedUser('alice');
    const scout = await seedScout(u.id, 'rss:espressif');
    const oppId = await seedOpportunity(u.id, 'ESP32-P4', {
      kind: 'iot',
      subscriptionId: scout.id,
      source: 'rss:espressif',
    });
    const { objects } = await listScoutFindings(u.id, scout.id);
    expect(objects.length).toBe(1);
    expect(objects[0]?.id).toBe(oppId);
  });

  it('falls back to body.source = scout.target for legacy opportunities without subscriptionId', async () => {
    const u = await seedUser('bob');
    const scout = await seedScout(u.id, 'rss:espressif');
    // Pre-0008-style opportunity: no subscriptionId, but source matches target
    const oppId = await seedOpportunity(u.id, 'Legacy ESP32 thing', {
      kind: 'iot',
      source: 'rss:espressif',
    });
    const { objects } = await listScoutFindings(u.id, scout.id);
    expect(objects.length).toBe(1);
    expect(objects[0]?.id).toBe(oppId);
  });

  it('falls back to body.target = scout.target', async () => {
    const u = await seedUser('carol');
    const scout = await seedScout(u.id, 'github:esphome');
    const oppId = await seedOpportunity(u.id, 'New ESPHome repo', {
      kind: 'iot',
      target: 'github:esphome',
    });
    const { objects } = await listScoutFindings(u.id, scout.id);
    expect(objects.length).toBe(1);
    expect(objects[0]?.id).toBe(oppId);
  });

  it('does not leak opportunities from other scouts', async () => {
    const u = await seedUser('dave');
    const scout = await seedScout(u.id, 'rss:espressif');
    await seedOpportunity(u.id, 'Stripe thing', { source: 'blog:stripe' });
    await seedOpportunity(u.id, 'YC thing', { source: 'rfs:ycombinator' });
    const { objects } = await listScoutFindings(u.id, scout.id);
    expect(objects.length).toBe(0);
  });

  it('excludes archived opportunities', async () => {
    const u = await seedUser('erin');
    const scout = await seedScout(u.id, 'rss:espressif');
    await seedOpportunity(u.id, 'archived opp', {
      subscriptionId: scout.id,
      source: 'rss:espressif',
      archivedAt: '2024-01-01T00:00:00Z',
    });
    // re-seed with archivedAt at the row level (not just in body)
    await db.execute(sql`update objects set archived_at = now() where user_id = ${u.id}`);
    const { objects } = await listScoutFindings(u.id, scout.id);
    expect(objects.length).toBe(0);
  });

  it('returns discoveries linked via body.subscriptionId', async () => {
    const u = await seedUser('frank');
    const scout = await seedScout(u.id, 'github:esphome');
    const discId = await seedObject(u.id, 'discovery', 'New ESPHome Projects', {
      subscriptionId: scout.id,
      source: 'github:esphome',
    });
    const { objects } = await listScoutFindings(u.id, scout.id);
    expect(objects.length).toBe(1);
    expect(objects[0]?.id).toBe(discId);
    expect(objects[0]?.type).toBe('discovery');
  });

  it('returns discoveries via source/target fallback for pre-subscriptionId rows', async () => {
    const u = await seedUser('grace');
    const scout = await seedScout(u.id, 'github:esphome');
    // Discovery without subscriptionId, but source matches
    const discId = await seedObject(u.id, 'discovery', 'Legacy ESPHome digest', {
      source: 'github:esphome',
    });
    const { objects } = await listScoutFindings(u.id, scout.id);
    expect(objects.length).toBe(1);
    expect(objects[0]?.id).toBe(discId);
  });

  it('returns multiple types (opportunity + discovery + research) from a single scout', async () => {
    const u = await seedUser('henry');
    const scout = await seedScout(u.id, 'github:esphome');
    const oppId = await seedOpportunity(u.id, 'ESPHome Dashboard Contributor Wanted', {
      subscriptionId: scout.id,
      kind: 'job',
    });
    const discId = await seedObject(u.id, 'discovery', 'New ESPHome Projects', {
      subscriptionId: scout.id,
    });
    const researchId = await seedObject(u.id, 'research', 'Matter Adoption Report', {
      subscriptionId: scout.id,
    });
    const { objects } = await listScoutFindings(u.id, scout.id);
    expect(objects.length).toBe(3);
    const ids = objects.map((o) => o.id).sort();
    expect(ids).toEqual([oppId, discId, researchId].sort());
  });

  it('excludes note (system bookkeeping) from findings', async () => {
    const u = await seedUser('ivy');
    const scout = await seedScout(u.id, 'rss:espressif');
    await seedObject(u.id, 'note', 'Internal note', { subscriptionId: scout.id });
    await seedObject(u.id, 'collection', 'A collection', { subscriptionId: scout.id });
    await seedOpportunity(u.id, 'Real finding', { subscriptionId: scout.id });
    const { objects } = await listScoutFindings(u.id, scout.id);
    // Only the opportunity should appear; notes/collections are not scout output.
    expect(objects.length).toBe(1);
    expect(objects[0]?.type).toBe('opportunity');
  });
});
