import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rotateMcpToken, setSchedulerEnabled } from '../data/auth.js';
import { savePushSubscription, removePushSubscription, getVapidPublicKey } from '@hermieos/mcp/src/data/push.js';
import { BadRequest, Unauthorized, sendError } from '../errors.js';

const schedulerBodySchema = z.object({
  enabled: z.boolean(),
});

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  // GET /me — current user
  app.get('/me', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    return { user: req.user };
  });

  // PATCH /me/scheduler — toggle the pause flag
  app.patch('/me/scheduler', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const parsed = schedulerBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    await setSchedulerEnabled(req.user.id, parsed.data.enabled);
    return { user: { ...req.user, schedulerEnabled: parsed.data.enabled } };
  });

  // POST /me/mcp-token/rotate — rotate the per-user MCP bearer token.
  // Returns the new token once. The user must update their Hermes profile.
  app.post('/me/mcp-token/rotate', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { mcpToken } = await rotateMcpToken(req.user.id);
    return { mcpToken };
  });

  // GET /me/push-vapid-key — the server's VAPID public key for Web Push
  app.get('/me/push-vapid-key', async () => {
    return { publicKey: getVapidPublicKey() };
  });

  // POST /me/push-subscription — save a browser push subscription
  app.post('/me/push-subscription', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const body = req.body as {
      endpoint?: string;
      keys?: { auth?: string; p256dh?: string };
      userAgent?: string;
    };
    if (!body.endpoint || !body.keys?.auth || !body.keys?.p256dh) {
      return sendError(
        reply,
        new BadRequest('endpoint, keys.auth, and keys.p256dh are required'),
        String(req.id),
      );
    }
    await savePushSubscription(req.user.id, {
      endpoint: body.endpoint,
      keys: { auth: body.keys.auth, p256dh: body.keys.p256dh },
      userAgent: body.userAgent,
    });
    return { ok: true };
  });

  // DELETE /me/push-subscription — remove a browser push subscription
  app.delete('/me/push-subscription', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const body = req.body as { endpoint?: string };
    if (!body.endpoint) {
      return sendError(reply, new BadRequest('endpoint is required'), String(req.id));
    }
    await removePushSubscription(req.user.id, body.endpoint);
    return { ok: true };
  });
}
