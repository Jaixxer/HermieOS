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
import { SESSION_COOKIE_NAME as SESSION_COOKIE_NAME_LOCAL, getSessionUser } from '../auth-middleware.js';
import { eq } from 'drizzle-orm';
import { BadRequest, Conflict, Unauthorized, sendError } from '../errors.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/signup', async (req, reply) => {
    // Signup is disabled server-side for now. No new accounts can be created
    // until SIGNUP_ENABLED=true is set in the environment.
    if (process.env.SIGNUP_ENABLED !== 'true') {
      return reply.code(403).send({ error: 'signup_disabled' });
    }
    const parsed = signupArgsSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const { email, password, displayName } = parsed.data;

    // Reject if email already taken.
    const existing = await findUserByEmail(email);
    if (existing) {
      return sendError(reply, new Conflict('email_taken'), String(req.id));
    }

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await createUser({ email, passwordHash, displayName });
    } catch (err) {
      // Race: someone else created the user between our check and our insert.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('duplicate')) {
        return sendError(reply, new Conflict('email_taken'), String(req.id));
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
      token: session.token,    // bearer token for persistent clients
      apiBase: apiBaseFor(req), // let desktop/mobile clients persist the origin
    };
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginArgsSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, new BadRequest('invalid_input', parsed.error.flatten()), String(req.id));
    }
    const { email, password } = parsed.data;
    const user = await findUserByEmail(email);
    if (!user || user.archivedAt) {
      return sendError(reply, new Unauthorized('invalid_credentials'), String(req.id));
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      return sendError(reply, new Unauthorized('invalid_credentials'), String(req.id));
    }
    const session = await createSession({
      userId: user.id,
      userAgent: req.headers['user-agent'] ?? undefined,
      ip: req.ip,
    });
    setSessionCookie(reply, session.token);
    return { user: publicUser(user), token: session.token, mcpToken: await mcpTokenFor(user.id), apiBase: apiBaseFor(req) };
  });

  app.post('/auth/logout', async (req, reply) => {
    // Works for both session-cookie web clients and bearer-token desktop clients.
    await getSessionUser(req);
    const token = req.cookies[SESSION_COOKIE_NAME_LOCAL] ?? req.sessionToken;
    if (token) {
      await deleteSession(token);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/auth/logout-all', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    await deleteAllUserSessions(req.user.id);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Display name edit
  app.patch('/me', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }
    const body = (req.body ?? {}) as { displayName?: unknown };
    if (typeof body.displayName !== 'string' || body.displayName.length < 1 || body.displayName.length > 100) {
      return sendError(reply, new BadRequest('displayName must be 1..100 chars'), String(req.id));
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

/**
 * Returns the public origin of the API server (e.g. `http://api.example.com`
 * or `http://localhost:3001`). Clients persist this alongside the
 * session token so a page refresh can resume the session without
 * the user going through the MCP connect flow first.
 */
function apiBaseFor(req: import('fastify').FastifyRequest): string {
  // X-Forwarded-* headers take precedence when behind a reverse proxy.
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ??
    req.protocol;
  const host =
    (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ??
    req.headers.host ??
    'localhost';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/** Read the user's MCP token out of the users table. */
async function mcpTokenFor(userId: string): Promise<string> {
  const { createDatabase, schema } = await import('@hermieos/db');
  // The API package reuses the same DATABASE_URL as the rest of the
  // stack. We open a short-lived client per call to avoid coupling
  // auth to the request-scoped db pool; sessions are infrequent.
  const db = createDatabase({
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:15432/hermieos',
    max: 1,
  });
  try {
    const rows = await db
      .select({ token: schema.users.mcpToken })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return rows[0]?.token ?? '';
  } finally {
    await db.$client.end();
  }
}
