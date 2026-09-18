import { randomUUID } from 'node:crypto';
import { getLogger, type Logger } from './logger.js';

export interface AppContext {
  log: Logger;
  requestId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: AppContext;
  }
}

/**
 * Per-request context.
 *
 * The logger here MUST be a `.child()` of the process-wide logger. Building a
 * fresh pino instance per request is what previously leaked a worker thread
 * (and a 4 MB SharedArrayBuffer) per request — see logger.ts. `.child()` shares
 * the parent stream and allocates no thread, so this is cheap enough for the
 * onRequest hook.
 */
export function buildContext(requestId: string = randomUUID()): AppContext {
  return { log: getLogger().child({ request_id: requestId }), requestId };
}
