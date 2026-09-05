import { and, count, desc, eq, gte, inArray, isNull, lt, not, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';
import { listTasks, type TaskRow } from './tasks.js';
import { listUpcoming, type UpcomingRow } from './upcoming.js';
import { getRecentActivity, type FeedEventRow } from './feed.js';
import { getUserGraph } from './relationships.js';

export interface OpportunityBucket {
  category: string;
  categoryId: string | null;
  total: number;
  unread: number;
  color?: string;
  icon?: string;
}

export interface DashboardData {
  tasks: {
    today: TaskRow[];
    overdue: TaskRow[];
    completedThisWeek: number;
  };
  upcoming: {
    next7Days: UpcomingRow[];
    next30Days: UpcomingRow[];
    next90Days: UpcomingRow[];
  };
  opportunities: {
    categories: OpportunityBucket[];
    recent: Array<{
      id: string;
      title: string;
      summary: string | null;
      kind: string;
      status: string;
      priority: number;
      updatedAt: Date;
    }>;
  };
  hermesFeed: {
    events: FeedEventRow[];
    hasMore: boolean;
  };
  graph: {
    nodes: Array<{ id: string; title: string; type: string }>;
    links: Array<{ source: string; target: string; kind: string; confidence: number }>;
  };
  generatedAt: string;
}

/**
 * Aggregated payload for the dashboard. Single round-trip for the home page.
 *
 * Opportunities are queried from the `objects` table where type='opportunity'.
 * Read state uses `objects.status`: 'open' = unread/new, 'archived' = dismissed.
 * The `kind` field is on `objects.body->>'kind'` (typed in opportunityBodySchema).
 */
export async function getDashboard(userId: string): Promise<DashboardData> {
  const db = getDb();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const sevenDaysOut = new Date(startOfDay);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const thirtyDaysOut = new Date(startOfDay);
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
  const ninetyDaysOut = new Date(startOfDay);
  ninetyDaysOut.setDate(ninetyDaysOut.getDate() + 90);
  const weekAgo = new Date(startOfDay);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Tasks due today + in progress + overdue.
  const todayTasks = await listTasks(userId, {
    since: startOfDay,
    until: endOfDay,
    status: 'todo',
    limit: 50,
  });
  const inProgress = await listTasks(userId, {
    status: 'in_progress',
    limit: 10,
  });
  const overdueRows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNull(schema.tasks.archivedAt),
        sql`${schema.tasks.status} <> 'done'`,
        sql`${schema.tasks.status} <> 'cancelled'`,
        lt(schema.tasks.dueAt, now),
      ),
    )
    .orderBy(schema.tasks.dueAt)
    .limit(20);
  const overdueTasks = overdueRows.map((r) => ({
    id: r.id,
    userId: r.userId,
    title: r.title,
    notes: r.notes,
    category: r.category,
    status: r.status,
    priority: r.priority,
    dueAt: r.dueAt,
    completedAt: r.completedAt,
    createdBy: r.createdBy,
    batchId: r.batchId,
    sentToHermesAt: r.sentToHermesAt,
    objectId: r.objectId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archivedAt: r.archivedAt,
  }));

  const completedRows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        eq(schema.tasks.status, 'done'),
        gte(schema.tasks.completedAt, weekAgo),
      ),
    );

  const upcoming7 = await listUpcoming(userId, {
    since: now,
    until: sevenDaysOut,
    limit: 10,
  });
  const upcoming30 = await listUpcoming(userId, {
    since: sevenDaysOut,
    until: thirtyDaysOut,
    limit: 50,
  });
  const upcoming90 = await listUpcoming(userId, {
    since: thirtyDaysOut,
    until: ninetyDaysOut,
    limit: 50,
  });

  // Opportunities: from objects(type='opportunity') table.
  // Group by category_id (FK), falling back to body->>'kind' for legacy
  // rows that pre-date the categories table. One SQL aggregate query
  // replaces the previous 100-row scan + JS Map aggregation.
  const bucketRows = await db
    .select({
      categoryId: sql<string | null>`${schema.objects.body}->>'category_id'`,
      legacyKind: sql<string>`coalesce(${schema.objects.body}->>'kind', 'other')`,
      total: count(),
      unread: sql<number>`count(*) filter (where ${schema.objects.status} = 'open')`,
    })
    .from(schema.objects)
    .where(
      and(
        eq(schema.objects.userId, userId),
        eq(schema.objects.type, 'opportunity'),
        isNull(schema.objects.archivedAt),
      ),
    )
    .groupBy(
      sql`${schema.objects.body}->>'category_id'`,
      sql`${schema.objects.body}->>'kind'`,
    );

  // Resolve category names/colors/icons in one query.
  const categoryIds = Array.from(
    new Set(
      bucketRows
        .map((r) => r.categoryId)
        .filter((id): id is string => !!id),
    ),
  );
  const categoryRows = categoryIds.length === 0
    ? []
    : await db
        .select({
          id: schema.categories.id,
          name: schema.categories.name,
          color: schema.categories.color,
          icon: schema.categories.icon,
        })
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.userId, userId),
            // inArray binds the id list as a proper array parameter —
            // a raw `ANY(${ids}::uuid[])` template sends a bare string
            // through postgres.js and dies with "malformed array literal".
            inArray(schema.categories.id, categoryIds),
          ),
        );
  const categoryById = new Map(
    categoryRows.map((c) => [c.id, { name: c.name, color: c.color, icon: c.icon }] as const),
  );

  // Fallback: for legacy rows without category_id, group by kind and
  // look up the category by name (case-insensitive) for appearance.
  const allCategories =
    categoryRows.length > 0
      ? categoryRows
      : (await db
          .select({
            id: schema.categories.id,
            name: schema.categories.name,
            color: schema.categories.color,
            icon: schema.categories.icon,
          })
          .from(schema.categories)
          .where(eq(schema.categories.userId, userId)));
  const categoryByName = new Map(
    allCategories.map((c) => [c.name.toLowerCase(), { id: c.id, name: c.name, color: c.color, icon: c.icon }] as const),
  );

  type BucketAgg = { categoryId: string | null; name: string; total: number; unread: number; color?: string; icon?: string };
  const aggMap = new Map<string, BucketAgg>();
  for (const r of bucketRows) {
    let id: string | null = r.categoryId;
    let name: string;
    let color: string | undefined;
    let icon: string | undefined;
    if (id && categoryById.has(id)) {
      const cat = categoryById.get(id)!;
      name = cat.name;
      color = cat.color;
      icon = cat.icon;
    } else if (id) {
      // category_id present but category row missing (shouldn't happen
      // under SET NULL). Show the id in parens for debugging.
      name = r.legacyKind;
    } else {
      // Legacy: fall back to body->>'kind' matched to a category by name.
      const match = categoryByName.get(r.legacyKind.toLowerCase());
      id = match?.id ?? null;
      name = match?.name ?? r.legacyKind;
      color = match?.color;
      icon = match?.icon;
    }
    const key = id ?? `legacy:${name}`;
    const cur = aggMap.get(key) ?? { categoryId: id, name, total: 0, unread: 0, color, icon };
    cur.total += Number(r.total);
    cur.unread += Number(r.unread);
    aggMap.set(key, cur);
  }
  const categories: OpportunityBucket[] = Array.from(aggMap.values())
    .map((b) => ({
      category: b.name,
      categoryId: b.categoryId,
      total: b.total,
      unread: b.unread,
      color: b.color,
      icon: b.icon,
    }))
    .sort((a, b) => b.unread - a.unread || b.total - a.total);

  // Recent (top 10) opportunity objects, newest first.
  const recentRows = await db
    .select({
      id: schema.objects.id,
      title: schema.objects.title,
      summary: schema.objects.summary,
      body: schema.objects.body,
      status: schema.objects.status,
      priority: schema.objects.priority,
      updatedAt: schema.objects.updatedAt,
    })
    .from(schema.objects)
    .where(
      and(
        eq(schema.objects.userId, userId),
        eq(schema.objects.type, 'opportunity'),
        isNull(schema.objects.archivedAt),
      ),
    )
    .orderBy(desc(schema.objects.priority), desc(schema.objects.updatedAt))
    .limit(10);

  const recent: DashboardData['opportunities']['recent'] = recentRows.map((r) => {
    const body = (r.body ?? {}) as Record<string, unknown>;
    const kind = typeof body.kind === 'string' ? body.kind : 'other';
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      kind,
      status: r.status,
      priority: r.priority,
      updatedAt: r.updatedAt,
    };
  });

  const feed = await getRecentActivity(userId, { limit: 12 });

  const graph = await getUserGraph(userId);

  return {
    tasks: {
      today: [...inProgress.tasks, ...todayTasks.tasks].slice(0, 10),
      overdue: overdueTasks.slice(0, 5),
      completedThisWeek: completedRows.length,
    },
    upcoming: {
      next7Days: upcoming7.items,
      next30Days: upcoming30.items,
      next90Days: upcoming90.items,
    },
    opportunities: {
      categories,
      recent,
    },
    hermesFeed: {
      events: feed.events,
      hasMore: feed.hasMore,
    },
    graph: {
      nodes: graph.nodes.map((n) => ({ id: n.id, title: n.title, type: n.type })),
      links: graph.links.map((l) => ({ source: l.source, target: l.target, kind: l.kind, confidence: l.confidence })),
    },
    generatedAt: now.toISOString(),
  };
}

// Avoid an unused-import warning on `not` (kept for future use in dashboard query helpers)
void not;
