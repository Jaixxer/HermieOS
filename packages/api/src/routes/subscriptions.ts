import type { FastifyInstance } from 'fastify';
import {
  archiveSubscription,
  createSubscription,
  listSubscriptions,
  updateSubscription,
} from '@hermieos/mcp/src/data/subscriptions.js';

export async function registerSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  // GET /subscriptions
  app.get('/subscriptions', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const q = req.query as { status?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const result = await listSubscriptions(
      req.user.id,
      q.status as 'active' | 'paused' | 'archived' | undefined,
      limit,
    );
    return result;
  });

  // POST /subscriptions
  app.post('/subscriptions', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const body = req.body as { name?: string; target?: string; instruction?: string; cadence?: string } | undefined;
    if (
      !body ||
      typeof body.name !== 'string' ||
      typeof body.target !== 'string' ||
      typeof body.instruction !== 'string' ||
      typeof body.cadence !== 'string'
    ) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const sub = await createSubscription(req.user.id, {
        name: body.name,
        target: body.target,
        instruction: body.instruction,
        cadence: body.cadence,
      });
      return { subscription: sub };
    } catch (err) {
      return reply.code(400).send({ error: 'create_failed', message: (err as Error).message });
    }
  });

  // PATCH /subscriptions/:id
  app.patch('/subscriptions/:id', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      name?: string;
      target?: string;
      instruction?: string;
      cadence?: string;
      status?: 'active' | 'paused' | 'archived';
    };
    try {
      const sub = await updateSubscription(req.user.id, id, {
        name: body.name,
        target: body.target,
        instruction: body.instruction,
        cadence: body.cadence,
        status: body.status,
      });
      return { subscription: sub };
    } catch (err) {
      return reply.code(400).send({ error: 'update_failed', message: (err as Error).message });
    }
  });

  // POST /subscriptions/:id/archive
  app.post('/subscriptions/:id/archive', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    try {
      const sub = await archiveSubscription(req.user.id, id);
      return { subscription: sub };
    } catch (err) {
      return reply.code(400).send({ error: 'archive_failed', message: (err as Error).message });
    }
  });
}
