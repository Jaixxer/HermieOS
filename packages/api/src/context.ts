import { randomUUID } from 'node:crypto';
import { createLogger, type Logger } from './logger.js';

export interface AppContext {
  log: Logger;
  requestId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: AppContext;
  }
}

export function buildContext(requestId: string = randomUUID()): AppContext {
  return { log: createLogger().child({ request_id: requestId }), requestId };
}
