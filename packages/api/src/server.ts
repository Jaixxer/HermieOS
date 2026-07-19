import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import * as ssePluginModule from '@fastify/sse';
import Fastify, { type FastifyInstance } from 'fastify';
import { loggerOptions } from './logger.js';
import { buildContext } from './context.js';
import { registerAuthDecorators, SESSION_COOKIE_NAME, getSessionUser } from './auth-middleware.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerFeedRoutes } from './routes/feed.js';
import { registerObjectRoutes } from './routes/objects.js';
import { registerSearchAndFeedbackRoutes } from './routes/search-feedback.js';
import { registerSubscriptionRoutes } from './routes/subscriptions.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerEventsRoutes } from './routes/events.js';
import { ApiError, sendError } from './errors.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(),
    genReqId: (req) => req.headers['x-request-id']?.toString() ?? randomUUID(),
    bodyLimit: 1024 * 1024, // 1 MiB
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET ?? 'dev-only-cookie-secret-change-me',
  });
  // The @fastify/sse 0.5.0 default export is wrapped in fastify-plugin,
  // which produces a value whose TypeScript signature doesn't structurally
  // match Fastify 5's plugin overloads. The runtime is correct.
  const ssePlugin = (ssePluginModule as unknown as { default: unknown }).default ?? ssePluginModule;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(ssePlugin as any);

  registerAuthDecorators(app);

  // Surface the request id in every response header so support can quote it.
  app.addHook('onSend', async (req, reply) => {
    if (req.id) reply.header('x-request-id', String(req.id));
  });

  app.addHook('onRequest', async (req) => {
    req.ctx = buildContext(req.id);
    if (req.url === '/healthz') return;
    req.user = await getSessionUser(req);
  });

  // Centralized error handler. Any thrown ApiError becomes a structured body;
  // any other thrown error becomes a 500 with a generic message + request id.
  // We never leak the raw error message or stack to clients.
  app.setErrorHandler((err, req, reply) => {
    const requestId = String(req.id);
    if (err instanceof ApiError) {
      return sendError(reply, err, requestId);
    }
    req.log.error({ err, requestId, url: req.url, method: req.method }, 'unhandled api error');
    reply.code(500);
    return reply.send({
      error: 'internal_error',
      message: 'An unexpected error occurred.',
      requestId,
    });
  });

  // 404 handler — same shape, so clients always have a requestId to quote.
  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return reply.send({
      error: 'not_found',
      message: `No route for ${req.method} ${req.url}`,
      requestId: String(req.id),
    });
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'hermieos-api' }));

  await registerAuthRoutes(app);
  await registerMeRoutes(app);
  await registerFeedRoutes(app);
  await registerObjectRoutes(app);
  await registerSearchAndFeedbackRoutes(app);
  await registerSubscriptionRoutes(app);
  await registerRunRoutes(app);
  await registerEventsRoutes(app);

  return app;
}

export { SESSION_COOKIE_NAME };

