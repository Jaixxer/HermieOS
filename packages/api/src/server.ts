import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { loggerOptions } from './logger.js';
import { buildContext } from './context.js';
import { registerAuthDecorators, SESSION_COOKIE_NAME } from './auth-middleware.js';
import { registerAuthRoutes } from './routes/auth.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(),
    genReqId: (req) => req.headers['x-request-id']?.toString() ?? randomUUID(),
    bodyLimit: 1024 * 1024, // 1 MiB
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET ?? 'dev-only-cookie-secret-change-me',
  });

  registerAuthDecorators(app);
  app.addHook('onRequest', async (req) => {
    req.ctx = buildContext(req.id);
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'hermieos-api' }));

  await registerAuthRoutes(app);

  return app;
}

export { SESSION_COOKIE_NAME };
