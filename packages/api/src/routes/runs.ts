import type { FastifyInstance } from 'fastify';
import { getRecentRuns } from '@hermieos/mcp/src/data/runs.js';

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  app.get('/runs', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const q = req.query as { status?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const result = await getRecentRuns(
      req.user.id,
      q.status as
        | 'dispatched'
        | 'running'
        | 'succeeded'
        | 'failed'
        | 'cancelled'
        | undefined,
      limit,
    );
    return result;
  });
}
