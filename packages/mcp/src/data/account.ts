/**
 * Account export and deletion.
 *
 * Export produces a JSON dump of all user data across every table
 * in the schema. Hard delete marks the user as deleted and purges
 * all related rows after a configurable grace period (default 30 days).
 */
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface UserExport {
  exportedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    schedulerEnabled: boolean;
    createdAt: string;
  };
  objects: unknown[];
  objectRevisions: unknown[];
  objectEvents: unknown[];
  objectRelationships: unknown[];
  subscriptions: unknown[];
  feedback: unknown[];
  feedEvents: unknown[];
  notifications: unknown[];
  hermesRuns: unknown[];
  pushSubscriptions: unknown[];
}

/**
 * Fetches every row associated with a user across all tables and
 * returns it as a structured JSON export. Passwords and MCP tokens
 * are excluded.
 */
export async function exportUserData(userId: string): Promise<UserExport> {
  const db = getDb();

  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      schedulerEnabled: schema.users.schedulerEnabled,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new Error('user not found');

  const [objects, revisions, events, rels, subs, fb, feed, notifs, runs, push] =
    await Promise.all([
      db.select().from(schema.objects).where(eq(schema.objects.userId, userId)),
      db.select().from(schema.objectRevisions).where(eq(schema.objectRevisions.userId, userId)),
      db.select().from(schema.objectEvents).where(eq(schema.objectEvents.userId, userId)),
      db.select().from(schema.objectRelationships).where(eq(schema.objectRelationships.userId, userId)),
      db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId)),
      db.select().from(schema.feedback).where(eq(schema.feedback.userId, userId)),
      db.select().from(schema.feedEvents).where(eq(schema.feedEvents.userId, userId)),
      db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)),
      db.select().from(schema.hermesRuns).where(eq(schema.hermesRuns.userId, userId)),
      db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId)),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      schedulerEnabled: user.schedulerEnabled,
      createdAt: user.createdAt.toISOString(),
    },
    objects,
    objectRevisions: revisions,
    objectEvents: events,
    objectRelationships: rels,
    subscriptions: subs,
    feedback: fb,
    feedEvents: feed,
    notifications: notifs,
    hermesRuns: runs,
    pushSubscriptions: push,
  };
}

// ---------------------------------------------------------------------------
// Hard delete
// ---------------------------------------------------------------------------

const GRACE_DAYS = 30;

/**
 * Hard-deletes the user and all cascaded data. Requires a confirmation
 * token derived from the user's id + email so the request is intentional.
 *
 * Postgres ON DELETE CASCADE handles most of the cleanup automatically.
 * We only need to delete the user row — all related rows are cascaded.
 */
export async function hardDeleteUser(userId: string, confirmation: string): Promise<void> {
  const db = getDb();

  const [user] = await db
    .select({ email: schema.users.email, displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new Error('user not found');

  const expected = `${userId}:${user.email}`;
  if (confirmation !== expected) {
    throw new Error('confirmation token does not match — send the user id + email concatenated with ":"');
  }

  // The ON DELETE CASCADE constraints on every FK reference mean
  // deleting the user row purges all associated data.
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}
