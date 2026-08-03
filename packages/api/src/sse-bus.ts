/**
 * SSE event bus.
 *
 * MVP: each connected client polls the database every 1s for feed
 * events newer than its last seen id. We use a per-connection cursor
 * and emit events as SSE. This is simple, works in a single-process
 * API, and doesn't require LISTEN/NOTIFY.
 *
 * Future: replace with LISTEN/NOTIFY for push-from-DB, or a Redis
 * pub/sub for multi-process.
 */
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase, schema, type Database } from '@hermieos/db';

let _db: Database | null = null;
function getDb(): Database {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _db = createDatabase({ url });
  }
  return _db;
}

export function setDb(db: Database): void {
  _db = db;
}

export interface StreamedFeedEvent {
  id: string;
  kind: string;
  objectId: string | null;
  title: string;
  body: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface StreamedRunUpdate {
  id: string;
  status: string;
  hermesRunId: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface StreamedNotification {
  id: string;
  objectId: string | null;
  title: string;
  body: string;
  priority: string;
  createdAt: string;
}

export type SseEvent =
  | { type: 'feed'; event: StreamedFeedEvent }
  | { type: 'notification'; event: StreamedNotification }
  | { type: 'run'; event: StreamedRunUpdate };

const POLL_MS = Number(process.env.SSE_POLL_MS ?? 1000);

export interface SseClientHandle {
  close(): void;
}

export interface SseClientHandlers {
  onEvent: (event: SseEvent) => void;
  onError?: (err: Error) => void;
}

export function openEventStream(
  userId: string,
  handlers: SseClientHandlers,
  lastEventId?: string,
): SseClientHandle {
  let lastFeedId = lastEventId ?? '';
  let lastNotificationId = '';
  let cancelled = false;
  const db = getDb();

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    try {
      // New feed events for this user
      const feedRows = await db
        .select()
        .from(schema.feedEvents)
        .where(
          and(
            eq(schema.feedEvents.userId, userId),
            lastFeedId
              ? sql`${schema.feedEvents.id} > ${lastFeedId}::uuid`
              : sql`true`,
          ),
        )
        .orderBy(sql`${schema.feedEvents.id} asc`)
        .limit(50);
      for (const row of feedRows) {
        handlers.onEvent({
          type: 'feed',
          event: {
            id: row.id,
            kind: row.kind,
            objectId: row.objectId,
            title: row.title,
            body: row.body,
            createdAt: row.createdAt.toISOString(),
            payload: (row.payload ?? {}) as Record<string, unknown>,
          },
        });
        lastFeedId = row.id;
      }

      // New notifications (created via notify_user) — lets clients
      // show in-app toasts + update the bell without polling.
      const notifRows = await db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, userId),
            lastNotificationId
              ? sql`${schema.notifications.id} > ${lastNotificationId}::uuid`
              : sql`true`,
          ),
        )
        .orderBy(sql`${schema.notifications.id} asc`)
        .limit(50);
      for (const row of notifRows) {
        handlers.onEvent({
          type: 'notification',
          event: {
            id: row.id,
            objectId: row.objectId,
            title: row.title,
            body: row.message,
            priority: row.priority,
            createdAt: row.createdAt.toISOString(),
          },
        });
        lastNotificationId = row.id;
      }
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Run the first tick immediately, then on an interval.
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, POLL_MS);
  timer.unref?.();

  return {
    close: () => {
      cancelled = true;
      clearInterval(timer);
    },
  };
}
