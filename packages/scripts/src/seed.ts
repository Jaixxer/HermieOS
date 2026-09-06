/**
 * Seed HermieOS with a small but interesting dataset.
 *
 * Creates one demo user, a project, a couple of discoveries linked
 * to it, a feed event, and a subscription.
 *
 * Idempotent: re-running will refresh the seeded data for the same
 * demo email.
 *
 * Run with: pnpm db:seed
 */
import { randomBytes } from 'node:crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import { createDatabase, closeDatabase, schema } from '@hermieos/db';
import { createObject } from '@hermieos/mcp/src/data/objects.js';
import { linkObjects } from '@hermieos/mcp/src/data/relationships.js';
import { recordFeedback, type FeedbackKind } from '@hermieos/mcp/src/data/feedback.js';
import { loadRootEnv } from '@hermieos/domain';

loadRootEnv();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://hermieos:hermieos@localhost:15432/hermieos';
}

const URL = process.env.DATABASE_URL;
const EMAIL = process.env.SEED_EMAIL ?? 'seed@hermieos.local';

const db = createDatabase({ url: URL });

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`seeding HermieOS for ${EMAIL}…`);

  // 0. clean prior seed data for this email
  const prior = await db.execute(drizzleSql`select id from users where email = ${EMAIL}`);
  const priorId = (prior[0] as { id: string } | undefined)?.id;
  if (priorId) {
    await db.execute(drizzleSql`delete from feedback where user_id = ${priorId}`);
    await db.execute(drizzleSql`delete from feed_events where user_id = ${priorId}`);
    await db.execute(drizzleSql`delete from subscriptions where user_id = ${priorId}`);
    await db.execute(
      drizzleSql`delete from object_relationships where from_id in (select id from objects where user_id = ${priorId})`,
    );
    await db.execute(
      drizzleSql`delete from object_revisions where user_id = ${priorId}`,
    );
    await db.execute(drizzleSql`delete from object_events where user_id = ${priorId}`);
    await db.execute(drizzleSql`delete from objects where user_id = ${priorId}`);
    await db.execute(drizzleSql`delete from users where id = ${priorId}`);
  }

  // 1. create the user
  const passwordHash = `seed:${randomBytes(8).toString('hex')}`; // placeholder
  const [{ id: userId }] = (await db
    .insert(schema.users)
    .values({
      email: EMAIL,
      passwordHash,
      displayName: 'Seed User',
      mcpToken: `mcp_seed_${randomBytes(12).toString('hex')}`,
      schedulerEnabled: true,
    })
    .returning()) as Array<{ id: string }>;
  if (!userId) throw new Error('user insert failed');
  // eslint-disable-next-line no-console
  console.log(`  created user ${userId}`);

  // 2. project + discoveries
  const project = await createObject(userId, {
    type: 'project',
    title: 'HermieOS seed project',
    summary: 'A demo project for manual testing',
    body: { goal: 'try the web UI' },
    tags: ['seed', 'demo'],
    source: 'user',
  });
  // eslint-disable-next-line no-console
  console.log(`  created project ${project.id}`);

  const discovery1 = await createObject(userId, {
    type: 'discovery',
    title: 'Hermes can call our MCP tools',
    summary: 'Verified the auth + tool surface',
    body: { evidence: 'see Phase 1 e2e' },
    tags: ['hermes', 'tools'],
    source: 'user',
  });
  // eslint-disable-next-line no-console
  console.log(`  created discovery ${discovery1.id}`);

  const discovery2 = await createObject(userId, {
    type: 'discovery',
    title: 'Postgres FTS works on body text',
    summary: 'GIN index on tsvector',
    body: { note: 'see migrations' },
    tags: ['search'],
    source: 'user',
  });

  // 3. link the discoveries to the project
  await linkObjects(
    userId,
    discovery1.id,
    project.id,
    'related_to',
    0.85,
    'discovered during the project',
    'user',
  );
  await linkObjects(
    userId,
    discovery2.id,
    project.id,
    'related_to',
    0.6,
    'supporting evidence',
    'user',
  );
  // eslint-disable-next-line no-console
  console.log(`  linked discoveries -> project`);

  // 4. feedback
  const feedback: Array<[string, FeedbackKind, string?]> = [
    [discovery1.id, 'like', 'great finding'],
    [discovery2.id, 'save'],
  ];
  for (const [objectId, kind, note] of feedback) {
    await recordFeedback(
      userId,
      objectId,
      kind,
      note ? { note } : {},
    );
  }
  // eslint-disable-next-line no-console
  console.log(`  recorded ${feedback.length} feedback rows`);

  // (No seeded scouts. The Scouting page starts empty; users create
  // their own scouts via the UI. Sample scout data was intentionally
  // removed so the Scouting Inbox reflects real activity, not fixtures.)

  // eslint-disable-next-line no-console
  console.log('\n  seed complete. Sign in with this email to see the data.');
  // eslint-disable-next-line no-console
  console.log(`  (note: passwordHash is a placeholder; sign up via the UI to get a real password.)`);
}

main()
  .then(() => closeDatabase(db))
  .then(() => process.exit(0))
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('seed failed:', err);
    await closeDatabase(db);
    process.exit(1);
  });
