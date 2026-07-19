import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findSessionByToken, touchSession, type SessionUser } from './data/auth.js';

export const SESSION_COOKIE_NAME = 'hermieos_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function getSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const found = await findSessionByToken(token);
  if (!found) return null;
  // Touch last_seen_at in the background; we don't need to wait.
  void touchSession(token).catch(() => undefined);
  return {
    id: found.user.id,
    email: found.user.email,
    displayName: found.user.displayName,
    mcpToken: found.user.mcpToken,
    schedulerEnabled: found.user.schedulerEnabled,
  };
}

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await getSessionUser(req);
  if (!user) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  return user;
}

export function registerAuthDecorators(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = null;
  });
}
