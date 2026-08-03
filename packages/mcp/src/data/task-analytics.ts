import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

export interface TaskAnalyticsDay {
  date: string;
  created: number;
  completed: number;
}

export interface TaskAnalytics {
  generatedAt: string;
  today: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    overdue: number;
    completionRate: number;
  };
  /** Tasks due tomorrow that are not done — "delegated to tomorrow". */
  deferredTomorrow: number;
  last7Days: TaskAnalyticsDay[];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Mission analytics for the user's own tasks. Answers:
 * - How many tasks were completed today?
 * - How many are pending / in progress / overdue?
 * - How many were pushed to tomorrow?
 * - A 7-day completed/created trend.
 */
export async function getTaskAnalytics(
  userId: string,
  days = 7,
): Promise<TaskAnalytics> {
  const db = getDb();
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd = new Date(todayStart);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 2);

  // Completed today (status done + completedAt within today).
  const completedRows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        eq(schema.tasks.status, 'done'),
        gte(schema.tasks.completedAt, todayStart),
        lt(schema.tasks.completedAt, todayEnd),
      ),
    );

  // Pending: not done/cancelled, due today or earlier, not archived.
  const pendingRows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNull(schema.tasks.archivedAt),
        sql`${schema.tasks.status} <> 'done'`,
        sql`${schema.tasks.status} <> 'cancelled'`,
        lt(schema.tasks.dueAt, todayEnd),
      ),
    );

  // In progress right now.
  const inProgressRows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        eq(schema.tasks.status, 'in_progress'),
        isNull(schema.tasks.archivedAt),
      ),
    );

  // Overdue: due before today, not done.
  const overdueRows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNull(schema.tasks.archivedAt),
        sql`${schema.tasks.status} <> 'done'`,
        sql`${schema.tasks.status} <> 'cancelled'`,
        lt(schema.tasks.dueAt, todayStart),
      ),
    );

  // Deferred to tomorrow: due tomorrow, not done.
  const deferredRows = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        isNull(schema.tasks.archivedAt),
        sql`${schema.tasks.status} <> 'done'`,
        sql`${schema.tasks.status} <> 'cancelled'`,
        gte(schema.tasks.dueAt, tomorrowStart),
        lt(schema.tasks.dueAt, tomorrowEnd),
      ),
    );

  // Last N days: created / completed counts per day. We pull timestamps
  // and bucket them in JS using local day boundaries, so the trend keys
  // match the local-midnight ranges used for the today/overdue buckets.
  const trendStart = startOfDay(now);
  trendStart.setDate(trendStart.getDate() - (days - 1));
  const dayKey = (d: Date | null): string | null => {
    if (!d) return null;
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return local.toISOString().slice(0, 10);
  };

  const trendRows = await db
    .select({ createdAt: schema.tasks.createdAt })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        gte(schema.tasks.createdAt, trendStart),
      ),
    );

  const completedTrendRows = await db
    .select({ completedAt: schema.tasks.completedAt })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        eq(schema.tasks.status, 'done'),
        gte(schema.tasks.completedAt, trendStart),
      ),
    );

  const createdByDay = new Map<string, number>();
  for (const r of trendRows) {
    const k = dayKey(r.createdAt);
    if (!k) continue;
    createdByDay.set(k, (createdByDay.get(k) ?? 0) + 1);
  }
  const completedByDay = new Map<string, number>();
  for (const r of completedTrendRows) {
    const k = dayKey(r.completedAt);
    if (!k) continue;
    completedByDay.set(k, (completedByDay.get(k) ?? 0) + 1);
  }
  const last7Days: TaskAnalyticsDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(trendStart);
    d.setDate(d.getDate() + i);
    const key = dayKey(d);
    if (!key) continue;
    last7Days.push({
      date: key,
      created: createdByDay.get(key) ?? 0,
      completed: completedByDay.get(key) ?? 0,
    });
  }

  const total = completedRows.length + pendingRows.length;
  return {
    generatedAt: now.toISOString(),
    today: {
      total,
      completed: completedRows.length,
      inProgress: inProgressRows.length,
      pending: pendingRows.length,
      overdue: overdueRows.length,
      completionRate: total === 0 ? 0 : completedRows.length / total,
    },
    deferredTomorrow: deferredRows.length,
    last7Days,
  };
}
