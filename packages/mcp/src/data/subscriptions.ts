import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { CADENCE_INTERVALS_MS } from '@hermieos/domain';
import { getDb } from './db.js';

export interface SubscriptionRow {
  id: string;
  userId: string;
  name: string;
  target: string;
  instruction: string;
  cadence: string;
  nextRunAt: Date;
  lastRunAt: Date | null;
  nextRetryAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  status: schema.Subscription['status'];
  createdAt: Date;
  updatedAt: Date;
}

function rowToSubscription(row: schema.Subscription): SubscriptionRow {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    target: row.target,
    instruction: row.instruction,
    cadence: row.cadence,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    nextRetryAt: row.nextRetryAt,
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function computeNextRunAt(cadence: string, from: Date = new Date()): Date {
  if (cadence.startsWith('cron:')) {
    // Not implemented in MVP; for cron: we leave nextRunAt to the user/scheduler.
    return from;
  }
  const interval = CADENCE_INTERVALS_MS[cadence];
  if (interval === null || interval === undefined) {
    throw new Error(`unknown cadence: ${cadence}`);
  }
  return new Date(from.getTime() + interval);
}

export async function createSubscription(
  userId: string,
  input: {
    name: string;
    target: string;
    instruction: string;
    cadence: string;
  },
): Promise<SubscriptionRow> {
  const db = getDb();
  const nextRunAt = computeNextRunAt(input.cadence);
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      userId,
      name: input.name,
      target: input.target,
      instruction: input.instruction,
      cadence: input.cadence,
      nextRunAt,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  return rowToSubscription(row);
}

export async function updateSubscription(
  userId: string,
  id: string,
  patch: {
    name?: string;
    target?: string;
    instruction?: string;
    cadence?: string;
    status?: schema.Subscription['status'];
  },
): Promise<SubscriptionRow> {
  const db = getDb();
  const set: Partial<typeof schema.subscriptions.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.target !== undefined) set.target = patch.target;
  if (patch.instruction !== undefined) set.instruction = patch.instruction;
  if (patch.cadence !== undefined) {
    set.cadence = patch.cadence;
    set.nextRunAt = computeNextRunAt(patch.cadence);
  }
  if (patch.status !== undefined) set.status = patch.status;

  const [row] = await db
    .update(schema.subscriptions)
    .set(set)
    .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, userId)))
    .returning();
  if (!row) throw new Error('subscription not found');
  return rowToSubscription(row);
}

export async function listSubscriptions(
  userId: string,
  status?: schema.Subscription['status'],
  limit = 50,
): Promise<{ subscriptions: SubscriptionRow[] }> {
  const db = getDb();
  const conds = [eq(schema.subscriptions.userId, userId)];
  if (status) conds.push(eq(schema.subscriptions.status, status));
  const rows = await db
    .select()
    .from(schema.subscriptions)
    .where(and(...conds))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(limit);
  return { subscriptions: rows.map(rowToSubscription) };
}

export async function archiveSubscription(
  userId: string,
  id: string,
): Promise<SubscriptionRow> {
  return updateSubscription(userId, id, { status: 'archived' });
}
