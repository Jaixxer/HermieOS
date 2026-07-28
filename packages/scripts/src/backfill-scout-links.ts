/**
 * One-time backfill: link existing objects to their producing scout.
 *
 * History: the `hermieos-subscription` skill was updated to instruct
 * Hermes to set `body.subscriptionId` on every object it creates or
 * updates, but the instruction was added after most discoveries and
 * opportunities had already been created. Those rows have no
 * `subscriptionId`, so the Findings tab on each scout comes up empty
 * even though the scout did produce them.
 *
 * We backfill using two sources of truth, in order:
 *   1. `feed_events.payload.source` for scout output where Hermes
 *      wrote the producing scout's name (patterns like
 *      `hermieos-subscription:esphome` or
 *      `hermieos-subscription/espressif-new-chips`).
 *   2. `hermes_runs.prompt::text LIKE '%<object-id>%'` for runs that
 *      included the object in their related_objects dispatch
 *      envelope — the most recent such run's `subscription_id` is
 *      the most likely producing scout.
 *
 * Safe to re-run; only updates objects whose `body.subscriptionId`
 * is currently null. New objects created after the skill update
 * already have the field set.
 *
 * Run with: tsx packages/scripts/src/backfill-scout-links.ts
 */
import { sql as drizzleSql } from 'drizzle-orm';
import { createDatabase, closeDatabase, schema } from '@hermieos/db';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://hermieos:hermieos@localhost:5432/hermieos';
}
const URL = process.env.DATABASE_URL;
const db = createDatabase({ url: URL });

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Backfilling object.subscriptionId…');

  // Pass 1: link by feed_events.payload.source (scout name).
  // Matches "hermieos-subscription:esphome" → "esphome",
  //          "hermieos-subscription/espressif-new-chips" → "Espressif new chips",
  //          "hermieos-subscription" (no scout) → skipped.
  const pass1 = await db.execute(drizzleSql`
    WITH linked AS (
      SELECT
        fe.object_id,
        s.id AS scout_id,
        ROW_NUMBER() OVER (
          PARTITION BY fe.object_id
          ORDER BY fe.created_at DESC
        ) AS rn
      FROM feed_events fe
      JOIN subscriptions s
        ON s.user_id = fe.user_id
       AND lower(s.name) = lower(
         regexp_replace(
           fe.payload->>'source',
           '^hermieos-subscription[:/]',
           ''
         )
       )
      WHERE fe.object_id IS NOT NULL
        AND fe.payload->>'source' ~ '^hermieos-subscription[:/].+'
    )
    UPDATE objects o
    SET body = o.body || jsonb_build_object('subscriptionId', l.scout_id::text)
    FROM linked l
    WHERE o.id = l.object_id
      AND l.rn = 1
      AND o.body->>'subscriptionId' IS NULL
      AND o.archived_at IS NULL
      AND o.type NOT IN ('note', 'collection')
    RETURNING o.id;
  `);

  // Pass 2: link by hermes_runs.prompt LIKE '%<object-id>%'. The
  // dispatch envelope includes related_objects; the most recent run
  // that mentioned the object is its best-guess producer.
  const pass2 = await db.execute(drizzleSql`
    WITH linked AS (
      SELECT
        o.id AS object_id,
        hr.subscription_id AS scout_id,
        ROW_NUMBER() OVER (
          PARTITION BY o.id
          ORDER BY hr.created_at DESC
        ) AS rn
      FROM objects o
      JOIN hermes_runs hr
        ON hr.user_id = o.user_id
       AND hr.subscription_id IS NOT NULL
       AND hr.prompt::text LIKE '%' || replace(o.id::text, '-', '')::text || '%'
      WHERE o.body->>'subscriptionId' IS NULL
        AND o.archived_at IS NULL
        AND o.type NOT IN ('note', 'collection')
    )
    UPDATE objects o
    SET body = o.body || jsonb_build_object('subscriptionId', l.scout_id::text)
    FROM linked l
    WHERE o.id = l.object_id
      AND l.rn = 1
    RETURNING o.id;
  `);

  const count = (r: unknown) =>
    (r as { count?: number; length?: number }).count
      ?? (Array.isArray(r) ? r.length : 0);
  // eslint-disable-next-line no-console
  console.log(`Pass 1 (feed_events.payload.source): ${count(pass1)} updated`);
  // eslint-disable-next-line no-console
  console.log(`Pass 2 (hermes_runs.prompt):        ${count(pass2)} updated`);

  // Report what got linked per scout.
  const summary = await db.execute(drizzleSql`
    SELECT s.name, COUNT(*) AS linked
    FROM objects o
    JOIN subscriptions s ON s.id = (o.body->>'subscriptionId')::uuid
    WHERE o.body->>'subscriptionId' IS NOT NULL
    GROUP BY s.name
    ORDER BY linked DESC;
  `);
  // eslint-disable-next-line no-console
  console.log('By scout:', JSON.stringify(summary, null, 2));
}

main()
  .then(async () => {
    await closeDatabase(db);
    process.exit(0);
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await closeDatabase(db);
    process.exit(1);
  });
