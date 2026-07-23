import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findSessionByToken, touchSession, findUserByMCPToken, type SessionUser } from './data/auth.js';

export const SESSION_COOKIE_NAME = 'hermieos_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    /** True when auth came from a bearer token (not session cookie) */
    authViaToken: boolean;
  }
}

export async function getSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  // 1. Try session cookie first
  const cookieToken = req.cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const found = await findSessionByToken(cookieToken);
    if (found) {
      void touchSession(cookieToken).catch(() => undefined);
      return {
        id: found.user.id,
        email: found.user.email,
        displayName: found.user.displayName,
        mcpToken: found.user.mcpToken,
        schedulerEnabled: found.user.schedulerEnabled,
      };
    }
  }

  // 2. Fall back to bearer token (MCP token) for desktop/mobile clients
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (match?.[1]) {
      const user = await findUserByMCPToken(match[1]);
      if (user) return user;
    }
  }

  return null;
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
