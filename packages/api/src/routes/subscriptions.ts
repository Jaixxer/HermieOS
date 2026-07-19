import type { FastifyInstance } from 'fastify';
import {
  archiveSubscription,
  createSubscription,
  listSubscriptions,
  updateSubscription,
} from '@hermieos/mcp/src/data/subscriptions.js';
import { BadRequest, Unauthorized, sendError } from '../errors.js';

export async function registerSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  // GET /subscriptions
  app.get('/subscriptions', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
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
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const body = req.body as { name?: string; target?: string; instruction?: string; cadence?: string } | undefined;
    if (
      !body ||
      typeof body.name !== 'string' ||
      typeof body.target !== 'string' ||
      typeof body.instruction !== 'string' ||
      typeof body.cadence !== 'string'
    ) {
      return sendError(reply, new BadRequest('name, target, instruction, cadence are required'), String(req.id));
    }
    const sub = await createSubscription(req.user.id, {
      name: body.name,
      target: body.target,
      instruction: body.instruction,
      cadence: body.cadence,
    });
    return { subscription: sub };
  });

  // PATCH /subscriptions/:id
  app.patch('/subscriptions/:id', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      name?: string;
      target?: string;
      instruction?: string;
      cadence?: string;
      status?: 'active' | 'paused' | 'archived';
    };
    const sub = await updateSubscription(req.user.id, id, {
      name: body.name,
      target: body.target,
      instruction: body.instruction,
      cadence: body.cadence,
      status: body.status,
    });
    return { subscription: sub };
  });

  // POST /subscriptions/:id/archive
  app.post('/subscriptions/:id/archive', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const sub = await archiveSubscription(req.user.id, id);
    return { subscription: sub };
  });
}
