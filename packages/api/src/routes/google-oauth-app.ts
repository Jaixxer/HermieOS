import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getGoogleOauthApp,
  upsertGoogleOauthApp,
  removeGoogleOauthApp,
} from '@hermieos/mcp/src/data/google-oauth-app.js';
import { BadRequest, Unauthorized, sendError } from '../errors.js';

const upsertBodySchema = z.object({
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(1024),
});

export function registerGoogleOauthAppRoutes(app: FastifyInstance): void {
  app.get('/google-oauth-app', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const app = await getGoogleOauthApp(req.user.id);
    return { app };
  });

  app.put('/google-oauth-app', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const body = (req.body ?? {}) as { clientId?: string; clientSecret?: string };
    const parsed = upsertBodySchema.safeParse(body);
    if (!parsed.success) {
      return sendError(
        reply,
        new BadRequest(`Invalid body: ${parsed.error.message}`),
        String(req.id),
      );
    }
    const app = await upsertGoogleOauthApp(req.user.id, parsed.data);
    return { app };
  });

  app.delete('/google-oauth-app', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    await removeGoogleOauthApp(req.user.id);
    return { ok: true };
  });
}