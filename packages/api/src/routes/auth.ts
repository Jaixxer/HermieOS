import type { FastifyInstance } from 'fastify';
import { signupArgsSchema, loginArgsSchema, SESSION_COOKIE_NAME } from '@hermieos/domain';
import { hashPassword, verifyPassword } from '../password.js';
import {
  createSession,
  createUser,
  deleteAllUserSessions,
  deleteSession,
  findUserByEmail,
  setDisplayName,
} from '../data/auth.js';
import { SESSION_COOKIE_NAME as SESSION_COOKIE_NAME_LOCAL } from '../auth-middleware.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/signup', async (req, reply) => {
    const parsed = signupArgsSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_input', details: parsed.error.flatten() };
    }
    const { email, password, displayName } = parsed.data;

    // Reject if email already taken.
    const existing = await findUserByEmail(email);
    if (existing) {
      reply.code(409);
      return { error: 'email_taken' };
    }

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await createUser({ email, passwordHash, displayName });
    } catch (err) {
      // Race: someone else created the user between our check and our insert.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('duplicate')) {
        reply.code(409);
        return { error: 'email_taken' };
      }
      throw err;
    }

    const session = await createSession({
      userId: user.id,
      userAgent: req.headers['user-agent'] ?? undefined,
      ip: req.ip,
    });
    setSessionCookie(reply, session.token);

    return {
      user: publicUser(user),
      mcpToken: user.mcpToken, // shown once
    };
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginArgsSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_input', details: parsed.error.flatten() };
    }
    const { email, password } = parsed.data;
    const user = await findUserByEmail(email);
    if (!user || user.archivedAt) {
      reply.code(401);
      return { error: 'invalid_credentials' };
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      reply.code(401);
      return { error: 'invalid_credentials' };
    }
    const session = await createSession({
      userId: user.id,
      userAgent: req.headers['user-agent'] ?? undefined,
      ip: req.ip,
    });
    setSessionCookie(reply, session.token);
    return { user: publicUser(user) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    if (token) {
      await deleteSession(token);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/auth/logout-all', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    await deleteAllUserSessions(req.user.id);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Display name edit
  app.patch('/me', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const body = (req.body ?? {}) as { displayName?: unknown };
    if (typeof body.displayName !== 'string' || body.displayName.length < 1 || body.displayName.length > 100) {
      reply.code(400);
      return { error: 'invalid_input' };
    }
    await setDisplayName(req.user.id, body.displayName);
    return { user: { ...req.user, displayName: body.displayName } };
  });
}

function setSessionCookie(reply: import('fastify').FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE_NAME_LOCAL, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });
}

function clearSessionCookie(reply: import('fastify').FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME_LOCAL, { path: '/' });
}

function publicUser(u: {
  id: string;
  email: string;
  displayName: string;
  schedulerEnabled: boolean;
}): { id: string; email: string; displayName: string; schedulerEnabled: boolean } {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    schedulerEnabled: u.schedulerEnabled,
  };
}
