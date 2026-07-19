import type { FastifyInstance } from 'fastify';
import { searchObjects } from '@hermieos/mcp/src/data/objects.js';
import { recordFeedback, type FeedbackKind } from '@hermieos/mcp/src/data/feedback.js';

const VALID_KINDS: FeedbackKind[] = ['like', 'save', 'ignore', 'archive', 'suggest'];

export async function registerSearchAndFeedbackRoutes(app: FastifyInstance): Promise<void> {
  // GET /search?q=...&type=...&limit=...
  app.get('/search', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const q = req.query as { q?: string; type?: string; limit?: string };
    if (!q.q || q.q.length === 0) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 100) : 25;
    const hits = await searchObjects(req.user.id, {
      query: q.q,
      type: q.type as never,
      limit,
    });
    return { hits };
  });

  // POST /objects/:id/feedback
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
      return { feedback };
    } catch (err) {
      return reply.code(400).send({ error: 'feedback_failed', message: (err as Error).message });
    }
  });
}
