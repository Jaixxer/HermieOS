import type { FastifyInstance } from 'fastify';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  getUnreadNotificationCount,
  notifyUser,
} from '@hermieos/mcp/src/data/notifications.js';
import { BadRequest, Unauthorized, sendError } from '../errors.js';

export async function registerNotificationsRoutes(app: FastifyInstance): Promise<void> {
  // POST /notifications/test — create a test notification to verify the
  // full pipeline (feed event + notification row + SSE + push + toast).
  // Uses the same code path as the MCP notify_user tool, bypassing the
  // daily rate limit so it can be used repeatedly while debugging.
  app.post('/notifications/test', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const n = await notifyUser(req.user.id, {
      title: 'Test notification',
      message: 'If you can read this, notifications are working.',
      priority: 'normal',
      source: 'test-button',
      skipRateLimit: true,
    });
    return { notification: n };
  });

  // GET /notifications?limit=&unreadOnly= — the user's notifications, newest first.
  app.get('/notifications', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const q = req.query as { limit?: string; unreadOnly?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 30, 1), 100) : 30;
    const unreadOnly = q.unreadOnly === 'true' || q.unreadOnly === '1';
    const notifications = await listNotifications(req.user.id, { limit, unreadOnly });
    const unread = await getUnreadNotificationCount(req.user.id);
    return {
      notifications: notifications.map((n) => ({
        id: n.id,
        objectId: n.objectId,
        title: n.title,
        message: n.message,
        priority: n.priority,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      unread,
    };
  });

  // GET /notifications/unread-count — cheap count for the bell badge.
  app.get('/notifications/unread-count', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const unread = await getUnreadNotificationCount(req.user.id);
    return { unread };
  });

  // POST /notifications/:id/read — mark a single notification read.
  app.post('/notifications/:id/read', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const ok = await markNotificationRead(req.user.id, id);
    if (!ok) {
      return sendError(reply, new BadRequest('notification not found'), String(req.id));
    }
    return { ok: true };
  });

  // POST /notifications/read — mark all notifications read.
  app.post('/notifications/read', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const updated = await markAllNotificationsRead(req.user.id);
    return { updated };
  });
}
