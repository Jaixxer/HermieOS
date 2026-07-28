/**
 * Categories — user-managed scouting buckets.
 *
 * Categories are the stable navigation surface for the Scouting Inbox.
 * The user creates, renames, recolors, and archives them. Hermes
 * never invents new top-level categories; it tags individual findings
 * with flexible labels instead.
 *
 * Invariants:
 *   - name is unique per user (case-insensitive on lookup, case-sensitive
 *     on the unique index)
 *   - archived categories are excluded from default lists
 *   - on delete (FK ON DELETE SET NULL), subscriptions.categoryId becomes
 *     null and the subscription becomes a non-scout
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Database } from '@hermieos/db';
import { getDb } from './db.js';

export interface CategoryRow {
  id: string;
  userId: string;
  name: string;
  color: schema.Category['color'];
  icon: schema.Category['icon'];
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToCategory(row: schema.Category): CategoryRow {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ListCategoriesInput {
  userId: string;
  includeArchived?: boolean;
  dbOverride?: Database;
}

export async function listCategories(input: ListCategoriesInput): Promise<{ categories: CategoryRow[] }> {
  const db = input.dbOverride ?? getDb();
  const conds = [eq(schema.categories.userId, input.userId)];
  if (!input.includeArchived) conds.push(isNull(schema.categories.archivedAt));
  const rows = await db
    .select()
    .from(schema.categories)
    .where(and(...conds))
    .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
  return { categories: rows.map(rowToCategory) };
}

export async function getCategory(userId: string, id: string): Promise<CategoryRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.categories)
    .where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId)))
    .limit(1);
  return row ? rowToCategory(row) : null;
}

export interface CreateCategoryInput {
  userId: string;
  name: string;
  color: schema.Category['color'];
  icon: schema.Category['icon'];
  sortOrder?: number;
}

export async function createCategory(input: CreateCategoryInput): Promise<CategoryRow> {
  const db = getDb();
  // If sortOrder is not provided, place at the end of the user's list.
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const [max] = await db
      .select({ m: sql<number>`coalesce(max(${schema.categories.sortOrder}), 0)` })
      .from(schema.categories)
      .where(eq(schema.categories.userId, input.userId));
    sortOrder = Number(max?.m ?? 0) + 10;
  }
  const [row] = await db
    .insert(schema.categories)
    .values({
      userId: input.userId,
      name: input.name,
      color: input.color,
      icon: input.icon,
      sortOrder,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  return rowToCategory(row);
}

export interface UpdateCategoryInput {
  userId: string;
  id: string;
  name?: string;
  color?: schema.Category['color'];
  icon?: schema.Category['icon'];
  sortOrder?: number;
}

export async function updateCategory(input: UpdateCategoryInput): Promise<CategoryRow> {
  const db = getDb();
  const set: Partial<typeof schema.categories.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.color !== undefined) set.color = input.color;
  if (input.icon !== undefined) set.icon = input.icon;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  const [row] = await db
    .update(schema.categories)
    .set(set)
    .where(and(eq(schema.categories.id, input.id), eq(schema.categories.userId, input.userId)))
    .returning();
  if (!row) throw new Error('category not found');
  return rowToCategory(row);
}

export async function archiveCategory(userId: string, id: string): Promise<CategoryRow> {
  const db = getDb();
  // Unassign any subscription that points at this category before
  // archiving, so the dashboard bucket stops showing it immediately.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.subscriptions)
      .set({ categoryId: null, updatedAt: new Date() })
      .where(and(eq(schema.subscriptions.categoryId, id), eq(schema.subscriptions.userId, userId)));
    await tx
      .update(schema.categories)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId)));
  });
  const cat = await getCategory(userId, id);
  if (!cat) throw new Error('category not found');
  return cat;
}

/** Lookup by lowercased name; returns null if not found. */
export async function findCategoryByName(
  userId: string,
  name: string,
): Promise<CategoryRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.userId, userId),
        sql`lower(${schema.categories.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return row ? rowToCategory(row) : null;
}
