import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rotateMcpToken, setSchedulerEnabled } from '../data/auth.js';
import { savePushSubscription, removePushSubscription, getVapidPublicKey } from '@hermieos/mcp/src/data/push.js';
import { exportUserData, hardDeleteUser } from '@hermieos/mcp/src/data/account.js';
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

  // GET /me/hermes-info — base URL + bearer token for the user's
  // Hermes Agent gateway. The web app needs both to call chat
  // endpoints (POST /api/sessions/:id/chat). Returning them together
  // avoids a round-trip through /me then a separate token fetch.
  app.get('/me/hermes-info', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const { readMcpTokenForUser } = await import('../data/auth.js');
    const token = await readMcpTokenForUser(req.user.id);
    // The Hermes Agent gateway uses a single shared API_SERVER_KEY for
    // chat sessions — there is no per-user identity in the gateway.
    // The browser needs that shared key to call /api/sessions endpoints.
    // We expose it here (only to authenticated users) so the web app
    // doesn't have to embed the key in the bundle.
    const sharedKey = process.env.HERMES_API_KEY ?? process.env.HERMES_GATEWAY_KEY ?? '';
    // The base URL the browser should use to reach Hermes. In production,
    // HERMES_PUBLIC_URL is set explicitly (e.g. https://hermes.example.com).
    // In dev / single-host setups Hermes runs on the same host as this API
    // but on a different port — we derive that from HERMES_GATEWAY_URL when
    // available, otherwise fall back to the API's own public origin (which
    // would only work when Hermes is reverse-proxied under the API).
    const fromEnv = process.env.HERMES_PUBLIC_URL?.replace(/\/+$/, '');
    if (fromEnv) return { baseUrl: fromEnv, token: sharedKey || token };
    const internal = process.env.HERMES_GATEWAY_URL;
    if (internal) {
      try {
        const u = new URL(internal);
        // Swap the docker-internal hostname for whatever the browser used to
        // reach us — most local installs run Hermes on the same machine.
        const proto =
          (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ??
          req.protocol;
        const hostHeader =
          (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ??
          req.headers.host ??
          'localhost';
        const hostOnly = hostHeader.split(':')[0] ?? 'localhost';
        return { baseUrl: `${proto}://${hostOnly}:${u.port || '8642'}`, token: sharedKey || token };
      } catch {
        // fall through
      }
    }
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ??
      req.protocol;
    const host =
      (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ??
      req.headers.host ??
      'localhost';
    const baseUrl = `${proto}://${host}`.replace(/\/+$/, '');
    return { baseUrl, token: sharedKey || token };
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

  // GET /me/export — returns a JSON dump of all user data
  app.get('/me/export', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const data = await exportUserData(req.user.id);
    reply.header('content-disposition', 'attachment; filename="hermieos-export.json"');
    return data;
  });

  // POST /me/delete — hard delete the account and all data.
  // Requires a confirmation token: the user's id + email joined by ':'.
  app.post('/me/delete', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const body = req.body as { confirmation?: string };
    if (!body.confirmation) {
      return sendError(
        reply,
        new BadRequest('confirmation token required — send user id + email joined by ":"'),
        String(req.id),
      );
    }
    await hardDeleteUser(req.user.id, body.confirmation);
    // Clear the session cookie since the account is gone
    reply.clearCookie('hermieos_session', { path: '/' });
    return { ok: true };
  });
}
