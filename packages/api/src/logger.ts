import pino, { type Logger, type LoggerOptions } from 'pino';

export function loggerOptions(): LoggerOptions {
  const level = process.env.LOG_LEVEL ?? 'info';
  const isDev = process.env.NODE_ENV !== 'production';
  return {
    level,
    base: { service: 'hermieos-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l' },
          },
        }
      : {}),
  };
}

/**
 * Standalone pino instance for code paths that are not inside a Fastify request
 * (e.g. boot scripts, cron helpers). Fastify itself creates its own logger
 * from the same options via the `logger` constructor option.
 */
export function createLogger(): Logger {
  return pino(loggerOptions());
}

export type { Logger } from 'pino';
