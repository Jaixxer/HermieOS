import { and, desc, eq } from 'drizzle-orm';
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
  categoryId: string | null;
  /**
   * Legacy free-form category text. Always null for new rows. Kept
   * for the transition window; will be dropped in a future migration.
   */
  category: string | null;
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
    categoryId: row.categoryId,
    category: row.category,
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
    categoryId?: string | null;
    categoryName?: string | null;
  },
): Promise<SubscriptionRow> {
  const db = getDb();
  const categoryId = await resolveCategoryId(userId, {
    categoryId: input.categoryId ?? null,
    categoryName: input.categoryName ?? null,
  });
  const nextRunAt = computeNextRunAt(input.cadence);
  const [row] = await db
    .insert(schema.subscriptions)
    .values({
      userId,
      name: input.name,
      target: input.target,
      instruction: input.instruction,
      cadence: input.cadence,
      categoryId,
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
    categoryId?: string | null;
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
  if (patch.categoryId !== undefined) {
    // explicit null = demote; otherwise validate ownership.
    set.categoryId =
      patch.categoryId === null
        ? null
        : await resolveCategoryId(userId, { categoryId: patch.categoryId });
  }

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

/**
 * Fetch a single subscription by id, scoped to the user. Returns
 * null when the id doesn't exist or belongs to another user.
 */
export async function getSubscription(
  userId: string,
  id: string,
): Promise<SubscriptionRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, userId)))
    .limit(1);
  return row ? rowToSubscription(row) : null;
}

export async function archiveSubscription(
  userId: string,
  id: string,
): Promise<SubscriptionRow> {
  return updateSubscription(userId, id, { status: 'archived' });
}

/**
 * Resolve a category identifier for a user. Accepts either an
 * existing categoryId (validated to belong to this user) or a
 * categoryName (looks up or creates a new category with default
 * appearance). Returns the resolved categoryId, or null for a
 * non-scout subscription.
 *
 * Used by createSubscription / updateSubscription to translate the
 * public "scouting category" input into the FK on the row.
 */
export async function resolveCategoryId(
  userId: string,
  input: { categoryId?: string | null; categoryName?: string | null },
): Promise<string | null> {
  if (input.categoryId === null && !input.categoryName) return null; // explicit demotion
  if (input.categoryId) {
    // Verify ownership — silently treat unknown / foreign ids as
    // invalid input by throwing. The caller is the API layer which
    // maps to a 400.
    const db = getDb();
    const { eq: eqQ, and: andQ } = await import('drizzle-orm');
    const [row] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(
        andQ(
          eqQ(schema.categories.id, input.categoryId),
          eqQ(schema.categories.userId, userId),
        ),
      )
      .limit(1);
    if (!row) throw new Error('category not found');
    return row.id;
  }
  if (input.categoryName) {
    // Reuse if it exists (case-insensitive match), otherwise create
    // with default appearance derived from the name.
    const db = getDb();
    const { eq: eqQ, and: andQ, sql: sqlQ } = await import('drizzle-orm');
    const [existing] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(
        andQ(
          eqQ(schema.categories.userId, userId),
          sqlQ`lower(${schema.categories.name}) = lower(${input.categoryName})`,
        ),
      )
      .limit(1);
    if (existing) return existing.id;
    // Pick a deterministic color/icon from a small mapping.
    const defaults = pickDefaults(input.categoryName);
    const [row] = await db
      .insert(schema.categories)
      .values({
        userId,
        name: input.categoryName,
        color: defaults.color,
        icon: defaults.icon,
      })
      .returning({ id: schema.categories.id });
    if (!row) throw new Error('failed to create category');
    return row.id;
  }
  return null;
}

// Deterministic color/icon from a category name so the UI looks
// reasonable even for Hermes-created categories.
function pickDefaults(name: string): { color: schema.Category['color']; icon: schema.Category['icon'] } {
  const known: Record<string, { color: schema.Category['color']; icon: schema.Category['icon'] }> = {
    job: { color: 'emerald', icon: 'briefcase' },
    startup: { color: 'purple', icon: 'trending-up' },
    research_paper: { color: 'sky', icon: 'file-text' },
    saas_idea: { color: 'amber', icon: 'lightbulb' },
    iot: { color: 'teal', icon: 'radar' },
    grant: { color: 'rose', icon: 'dollar-sign' },
    competition: { color: 'indigo', icon: 'trophy' },
    other: { color: 'slate', icon: 'help-circle' },
  };
  if (known[name]) return known[name]!;
  // Hash to a stable choice
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
  const colors: schema.Category['color'][] = ['emerald', 'sky', 'purple', 'amber', 'rose', 'slate', 'teal', 'indigo'];
  const icons: schema.Category['icon'][] = ['briefcase', 'trending-up', 'file-text', 'lightbulb', 'radar', 'trophy', 'help-circle'];
  return {
    color: colors[Math.abs(h) % colors.length]!,
    icon: icons[Math.abs(h) % icons.length]!,
  };
}

/**
 * Force the subscription to be due on the next scheduler tick by
 * setting `nextRunAt` to now and clearing any `nextRetryAt`. Used by
 * the "Run Now" UI button. Does not bypass the single-instance
 * lock or dispatch directly; the next tick will pick it up.
 *
 * Returns the updated row. Throws if not found or archived.
 */
export async function runSubscriptionNow(
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<SubscriptionRow> {
  const db = getDb();
  const [row] = await db
    .update(schema.subscriptions)
    .set({
      nextRunAt: now,
      nextRetryAt: null,
      // If the user forced a run, treat it as an active scout again —
      // we don't want a paused scout to swallow the request.
      status: 'active',
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.subscriptions.id, id),
        eq(schema.subscriptions.userId, userId),
        // Allow re-activation; only refuse if the user explicitly
        // archived it. Paused scouts are un-paused.
      ),
    )
    .returning();
  if (!row) throw new Error('subscription not found');
  return rowToSubscription(row);
}
