import type { FastifyInstance } from 'fastify';
import { createTtlCache } from '@hermieos/cache';
import { getRecentActivity, markFeedRead } from '@hermieos/mcp/src/data/feed.js';

const FEED_CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 120_000);
const FEED_CACHE_MAX_ENTRIES = 1000;
const feedCache = createTtlCache<string, unknown>({
  ttlMs: FEED_CACHE_TTL_MS,
  maxEntries: FEED_CACHE_MAX_ENTRIES,
});
// Track cache keys by user so we can invalidate per-user on write.
const feedCacheKeysByUser = new Map<string, Set<string>>();

function feedCacheKey(
  userId: string,
  q: { since?: string; limit?: string; kinds?: string },
): string {
  return `${userId}|${q.since ?? ''}|${q.limit ?? ''}|${q.kinds ?? ''}`;
}

function invalidateUserCache(userId: string): void {
  const keys = feedCacheKeysByUser.get(userId);
  if (!keys) return;
  for (const k of keys) feedCache.delete(k);
  keys.clear();
  feedCacheKeysByUser.delete(userId);
}

function trackKey(userId: string, key: string): void {
  let set = feedCacheKeysByUser.get(userId);
  if (!set) {
    set = new Set();
    feedCacheKeysByUser.set(userId, set);
  }
  set.add(key);
}

export async function registerFeedRoutes(app: FastifyInstance): Promise<void> {
  // GET /feed?since=...&limit=...&kinds=...  (cached for 2 min)
  app.get('/feed', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const q = req.query as { since?: string; limit?: string; kinds?: string };
    const cacheKey = feedCacheKey(req.user.id, q);
    const cached = feedCache.get(cacheKey);
    if (cached !== undefined) {
      reply.header('x-cache', 'hit');
      return cached;
    }
    const since = q.since ? new Date(q.since) : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const kinds = q.kinds ? q.kinds.split(',').filter(Boolean) : undefined;

    const result = await getRecentActivity(req.user.id, {
      since,
      limit,
      kinds,
    });
    feedCache.set(cacheKey, result);
    trackKey(req.user.id, cacheKey);
    reply.header('x-cache', 'miss');
    return result;
  });

  // GET /feed/unread-count (cheap; not cached)
  app.get('/feed/unread-count', async (req) => {
    if (!req.user) {
      return { error: 'unauthorized' };
    }
    const result = await getRecentActivity(req.user.id, { limit: 200 });
    const unread = result.events.filter((e) => e.readAt === null).length;
    return { unread };
  });

  // POST /feed/mark-read invalidates the cache for this user
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
    invalidateUserCache(req.user.id);
    const result = await markFeedRead(req.user.id, upTo);
    return result;
  });
}
