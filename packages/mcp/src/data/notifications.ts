import { and, count, desc, eq, gte, isNull } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { NOTIFY_USER_DAILY_LIMIT } from '@hermieos/domain';
import { getDb } from './db.js';
import { getObject } from './objects.js';
import { sendPushNotifications } from './push.js';

export interface NotificationRow {
  id: string;
  userId: string;
  objectId: string | null;
  title: string;
  message: string;
  priority: schema.Notification['priority'];
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}

function rowToNotification(row: schema.Notification): NotificationRow {
  return {
    id: row.id,
    userId: row.userId,
    objectId: row.objectId,
    title: row.title,
    message: row.message,
    priority: row.priority,
    deliveredAt: row.deliveredAt,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export class RateLimitError extends Error {
  readonly count: number;
  readonly limit: number;
  constructor(count: number, limit: number) {
    super(`notify_user: rate limit exceeded (${count}/${limit} today)`);
    this.name = 'RateLimitError';
    this.count = count;
    this.limit = limit;
  }
}

export async function notifyUser(
  userId: string,
  input: {
    title: string;
    message: string;
    priority: 'low' | 'normal' | 'high';
    objectId?: string;
    source: string;
    /** Bypass the 5/day rate limit. Only for the test-notification
     *  endpoint — the MCP notify_user tool never sets this. */
    skipRateLimit?: boolean;
  },
): Promise<NotificationRow> {
  // Optional ownership check on objectId
  if (input.objectId) {
    const owner = await getObject(userId, input.objectId);
    if (!owner) throw new Error('object not found');
  }

  const db = getDb();
  const start = startOfToday();

  // Count today's notifications for this user. The limit is on what notify_user
  // emits, not on what the system creates. The scheduler's system_notify path
  // for third-failure alerts also calls notify_user, so it counts against
  // the budget.
  const [row] = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.userId, userId), gte(schema.notifications.createdAt, start)),
    );
  const todayCount = Number(row?.n ?? 0);
  if (!input.skipRateLimit && todayCount >= NOTIFY_USER_DAILY_LIMIT) {
    throw new RateLimitError(todayCount, NOTIFY_USER_DAILY_LIMIT);
  }

  const [created] = await db
    .insert(schema.notifications)
    .values({
      userId,
      objectId: input.objectId ?? null,
      title: input.title,
      message: input.message,
      priority: input.priority,
    })
    .returning();
  if (!created) throw new Error('insert failed');

  // Also emit a feed event so the notification appears in the user's Feed.
  const [feedEvent] = await db
    .insert(schema.feedEvents)
    .values({
      userId,
      kind: 'notification',
      objectId: input.objectId ?? null,
      title: input.title,
      body: input.message,
      payload: { priority: input.priority, source: input.source, notificationId: created.id },
    })
    .returning({ id: schema.feedEvents.id });

  if (feedEvent) {
    await db
      .update(schema.notifications)
      .set({ feedEventId: feedEvent.id })
      .where(eq(schema.notifications.id, created.id));
  }

  // Fire-and-forget push delivery — don't block the response on push
  sendPushNotifications(userId, {
    title: input.title,
    body: input.message,
    url: `/objects/${input.objectId ?? ''}`,
    tag: `notify-${created.id}`,
  }).catch(() => {
    // Push delivery failures are non-fatal
  });

  return rowToNotification(created);
}

export async function listNotifications(
  userId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  const db = getDb();
  const conds = [eq(schema.notifications.userId, userId)];
  if (opts.unreadOnly) conds.push(isNull(schema.notifications.readAt));
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(and(...conds))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(opts.limit ?? 30);
  return rows.map(rowToNotification);
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)),
    );
  return Number(row?.n ?? 0);
}

export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)),
    )
    .returning({ id: schema.notifications.id });
  return result.length > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)),
    )
    .returning({ id: schema.notifications.id });
  return result.length;
}
