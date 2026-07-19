import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { loggerOptions } from './logger.js';
import { buildContext } from './context.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(),
    genReqId: (req) => req.headers['x-request-id']?.toString() ?? randomUUID(),
  });

  app.addHook('onRequest', async (req) => {
    req.ctx = buildContext(req.id);
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'hermieos-api' }));

  app.get('/hello', async (req) => {
    req.log.info({ route: '/hello' }, 'hello called');
    return { hello: 'world', requestId: req.ctx.requestId };
  });

  return app;
}
