/**
 * Performance smoke test: a Feed query for a user with 10k events
 * returns in < 100ms; a search query for a user with 10k Objects
 * returns in < 200ms.
 *
 * Per the Phase 5 exit criterion in docs/roadmap.md.
 *
 * Run with: tsx packages/scripts/src/perf-smoke.ts
 */
import { sql as drizzleSql } from 'drizzle-orm';
import { createDatabase, closeDatabase, schema } from '@hermieos/db';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://hermieos:hermieos@localhost:5432/hermieos';
}
const URL = process.env.DATABASE_URL;

const FEED_BUDGET_MS = 100;
const SEARCH_BUDGET_MS = 200;
const N_EVENTS = 10_000;
const N_OBJECTS = 10_000;

const db = createDatabase({ url: URL });

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Phase 5 performance smoke');
  const start = Date.now();

  // 0. seed a user
  const email = `perf-${Date.now()}@perf.local`;
  const [{ id: userId }] = (await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: 'perf',
      displayName: 'Perf',
      mcpToken: `mcp_perf_${Date.now()}`,
    })
    .returning()) as Array<{ id: string }>;
  if (!userId) throw new Error('user insert failed');

  // 1. seed N feed events in batches
  const eventBatch = 1000;
  // eslint-disable-next-line no-console
  console.log(`  seeding ${N_EVENTS} feed events…`);
  for (let i = 0; i < N_EVENTS; i += eventBatch) {
    const values = Array.from({ length: eventBatch }, (_, j) => ({
      userId,
      kind: 'object_created',
      objectId: null,
      title: `perf-event-${i + j}`,
      payload: { i: i + j },
    }));
    await db.insert(schema.feedEvents).values(values);
  }

  // 2. seed N objects
  // eslint-disable-next-line no-console
  console.log(`  seeding ${N_OBJECTS} objects…`);
  const objBatch = 500;
  for (let i = 0; i < N_OBJECTS; i += objBatch) {
    const values = Array.from({ length: objBatch }, (_, j) => ({
      userId,
      type: 'note' as const,
      title: `Perf Object ${i + j}`,
      summary: 'A perf test object',
      body: { note: 'this is a long body used to test FTS performance' },
      tags: ['perf'],
      createdBy: 'user' as const,
    }));
    await db.insert(schema.objects).values(values);
  }
  // eslint-disable-next-line no-console
  console.log(`  seed took ${Date.now() - start}ms`);

  // 3. measure feed query (latest 50 events)
  const feedTimings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await db.execute(
      drizzleSql`select * from feed_events where user_id = ${userId} order by created_at desc limit 50`,
    );
    feedTimings.push(performance.now() - t0);
  }
  const feedMedian = median(feedTimings);
  // eslint-disable-next-line no-console
  console.log(`  feed (50 of 10k): ${feedMedian.toFixed(1)}ms median, ${feedTimings.map((t) => t.toFixed(1)).join(', ')}ms`);

  // 4. measure search query
  const searchTimings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await db.execute(
      drizzleSql`select id, type, title from objects where user_id = ${userId} and search_vector @@ plainto_tsquery('english', 'perf') order by ts_rank(search_vector, plainto_tsquery('english', 'perf')) desc limit 25`,
    );
    searchTimings.push(performance.now() - t0);
  }
  const searchMedian = median(searchTimings);
  // eslint-disable-next-line no-console
  console.log(`  search: ${searchMedian.toFixed(1)}ms median, ${searchTimings.map((t) => t.toFixed(1)).join(', ')}ms`);

  // 5. cleanup
  await db.execute(drizzleSql`delete from feed_events where user_id = ${userId}`);
  await db.execute(drizzleSql`delete from object_revisions where user_id = ${userId}`);
  await db.execute(drizzleSql`delete from objects where user_id = ${userId}`);
  await db.execute(drizzleSql`delete from users where id = ${userId}`);

  // 6. verdict
  const ok = feedMedian < FEED_BUDGET_MS && searchMedian < SEARCH_BUDGET_MS;
  // eslint-disable-next-line no-console
  console.log(
    `  verdict: feed ${feedMedian.toFixed(1)}ms < ${FEED_BUDGET_MS}? ${feedMedian < FEED_BUDGET_MS}; search ${searchMedian.toFixed(1)}ms < ${SEARCH_BUDGET_MS}? ${searchMedian < SEARCH_BUDGET_MS}`,
  );
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error('\n  performance budget exceeded');
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('\n  performance smoke PASSED');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

main()
  .then(() => closeDatabase(db))
  .then(() => process.exit(0))
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('perf smoke failed:', err);
    await closeDatabase(db);
    process.exit(1);
  });
