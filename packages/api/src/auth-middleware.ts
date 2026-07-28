import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findSessionByToken, touchSession, findUserByMCPToken, type SessionUser } from './data/auth.js';

export const SESSION_COOKIE_NAME = 'hermieos_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    /** The session/bearer token that authenticated this request, if any */
    sessionToken: string | null;
    /** True when auth came from a bearer token (not session cookie) */
    authViaToken: boolean;
  }
}

export async function getSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  req.sessionToken = null;
  req.authViaToken = false;

  // 1. Try session cookie first
  const cookieToken = req.cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const found = await findSessionByToken(cookieToken);
    if (found) {
      req.sessionToken = cookieToken;
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

  // 2. Fall back to bearer token (session token or MCP token) for desktop/mobile clients
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    const bearer = match?.[1];
    if (bearer) {
      req.authViaToken = true;
      // Try session token first
      const session = await findSessionByToken(bearer);
      if (session) {
        req.sessionToken = bearer;
        void touchSession(bearer).catch(() => undefined);
        return {
          id: session.user.id,
          email: session.user.email,
          displayName: session.user.displayName,
          mcpToken: session.user.mcpToken,
          schedulerEnabled: session.user.schedulerEnabled,
        };
      }
      // Fall back to MCP token
      const user = await findUserByMCPToken(bearer);
      if (user) {
        req.sessionToken = bearer;
        return user;
      }
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
  req.user = user;
  return user;
}

export function registerAuthDecorators(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('authViaToken', false);
  app.addHook('onRequest', async (req) => {
    req.user = null;
    req.sessionToken = null;
    req.authViaToken = false;
  });
}
