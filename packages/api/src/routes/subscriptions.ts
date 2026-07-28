import type { FastifyInstance } from 'fastify';
import {
  archiveSubscription,
  createSubscription,
  listSubscriptions,
  runSubscriptionNow,
  updateSubscription,
} from '@hermieos/mcp/src/data/subscriptions.js';
import {
  getScoutMetrics,
  getScoutRunHistory,
  type HermesRunRow,
  type ScoutMetrics,
} from '@hermieos/mcp/src/data/runs.js';
import { listScoutFindings } from '@hermieos/mcp/src/data/objects.js';
import { BadRequest, NotFound, Unauthorized, sendError } from '../errors.js';

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
    const body = req.body as
      | { name?: string; target?: string; instruction?: string; cadence?: string; categoryId?: string; categoryName?: string }
      | undefined;
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
      categoryId: body.categoryId ?? null,
      categoryName: body.categoryName ?? null,
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
      categoryId?: string | null;
    };
    const sub = await updateSubscription(req.user.id, id, {
      name: body.name,
      target: body.target,
      instruction: body.instruction,
      cadence: body.cadence,
      status: body.status,
      categoryId: body.categoryId,
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

  // POST /subscriptions/:id/run-now — set nextRunAt=now so the next
  // scheduler tick dispatches the scout. Idempotent.
  app.post('/subscriptions/:id/run-now', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    try {
      const sub = await runSubscriptionNow(req.user.id, id);
      return { subscription: sub };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return sendError(reply, new NotFound(message), String(req.id));
    }
  });

  // GET /subscriptions/:id/metrics — aggregate per-scout metrics from
  // hermes_runs + opportunities.
  app.get('/subscriptions/:id/metrics', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const subs = await listSubscriptions(req.user.id, undefined, 500);
    const sub = subs.subscriptions.find((s) => s.id === id);
    if (!sub) {
      return sendError(reply, new NotFound('subscription not found'), String(req.id));
    }
    const metrics: ScoutMetrics = await getScoutMetrics(req.user.id, sub.id, sub.target);
    return metrics;
  });

  // GET /subscriptions/:id/runs — paginated run history for one scout.
  app.get('/subscriptions/:id/runs', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; status?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200) : 50;
    const result = await getScoutRunHistory(req.user.id, id, limit);
    return { runs: result.runs as HermesRunRow[] };
  });

  // GET /subscriptions/:id/findings — opportunity objects this scout has
  // produced (matched via body->>'subscriptionId').
  app.get('/subscriptions/:id/findings', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100) : 20;
    const result = await listScoutFindings(req.user.id, id, limit);
    return { objects: result.objects };
  });
}
