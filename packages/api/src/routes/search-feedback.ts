import type { FastifyInstance } from 'fastify';
import { createTtlCache } from '@hermieos/cache';
import { searchObjects } from '@hermieos/mcp/src/data/objects.js';
import { recordFeedback, type FeedbackKind } from '@hermieos/mcp/src/data/feedback.js';

const VALID_KINDS: FeedbackKind[] = ['like', 'save', 'ignore', 'archive', 'suggest'];

const SEARCH_CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 120_000);
const searchCache = createTtlCache<string, unknown>({
  ttlMs: SEARCH_CACHE_TTL_MS,
  maxEntries: 1000,
});
const searchCacheKeysByUser = new Map<string, Set<string>>();

function searchCacheKey(
  userId: string,
  q: { q?: string; type?: string; limit?: string },
): string {
  return `${userId}|${q.q ?? ''}|${q.type ?? ''}|${q.limit ?? ''}`;
}

function invalidateUserSearch(userId: string): void {
  const keys = searchCacheKeysByUser.get(userId);
  if (!keys) return;
  for (const k of keys) searchCache.delete(k);
  keys.clear();
  searchCacheKeysByUser.delete(userId);
}

function trackSearchKey(userId: string, key: string): void {
  let set = searchCacheKeysByUser.get(userId);
  if (!set) {
    set = new Set();
    searchCacheKeysByUser.set(userId, set);
  }
  set.add(key);
}

export async function registerSearchAndFeedbackRoutes(app: FastifyInstance): Promise<void> {
  // GET /search?q=...&type=...&limit=...  (cached for 2 min)
  app.get('/search', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const q = req.query as { q?: string; type?: string; limit?: string };
    if (!q.q || q.q.length === 0) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 100) : 25;
    const cacheKey = searchCacheKey(req.user.id, q);
    const cached = searchCache.get(cacheKey);
    if (cached !== undefined) {
      reply.header('x-cache', 'hit');
      return cached;
    }
    const hits = await searchObjects(req.user.id, {
      query: q.q,
      type: q.type as never,
      limit,
    });
    searchCache.set(cacheKey, { hits });
    trackSearchKey(req.user.id, cacheKey);
    reply.header('x-cache', 'miss');
    return { hits };
  });

  // POST /objects/:id/feedback — also invalidates the search cache
  app.post('/objects/:id/feedback', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { kind?: string; payload?: Record<string, unknown> };
    if (!body.kind || !VALID_KINDS.includes(body.kind as FeedbackKind)) {
      return reply.code(400).send({ error: 'invalid_kind' });
    }
    try {
      const feedback = await recordFeedback(
        req.user.id,
        id,
        body.kind as FeedbackKind,
        body.payload,
      );
      // Feedback doesn't change object content for FTS, but invalidate
      // for safety — it's a cheap write.
      invalidateUserSearch(req.user.id);
      return { feedback };
    } catch (err) {
      return reply.code(400).send({ error: 'feedback_failed', message: (err as Error).message });
    }
  });
}
