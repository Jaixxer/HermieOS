import type { FastifyInstance } from 'fastify';
import { getRecentActivity, markFeedRead } from '@hermieos/mcp/src/data/feed.js';

export async function registerFeedRoutes(app: FastifyInstance): Promise<void> {
  // GET /feed?since=...&limit=...&kinds=...
  app.get('/feed', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const q = req.query as { since?: string; limit?: string; kinds?: string };
    const since = q.since ? new Date(q.since) : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const kinds = q.kinds ? q.kinds.split(',').filter(Boolean) : undefined;

    const result = await getRecentActivity(req.user.id, {
      since,
      limit,
      kinds,
    });
    return { ...result, userId: undefined };
  });

  // GET /feed/unread-count
  app.get('/feed/unread-count', async (req) => {
    if (!req.user) {
      return { error: 'unauthorized' };
    }
    // Count by reading the last 200 events; this is cheap enough for the
    // MVP and we can move to a denormalized counter later.
    const result = await getRecentActivity(req.user.id, { limit: 200 });
    const unread = result.events.filter((e) => e.readAt === null).length;
    return { unread };
  });

  // POST /feed/mark-read
  app.post('/feed/mark-read', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const body = (req.body ?? {}) as { upTo?: string };
    if (typeof body.upTo !== 'string') {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const upTo = new Date(body.upTo);
    if (Number.isNaN(upTo.getTime())) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const result = await markFeedRead(req.user.id, upTo);
    return result;
  });
}
