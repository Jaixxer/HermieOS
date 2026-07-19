import type { Logger } from 'pino';
import pino from 'pino';

export function createLogger(): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const isDev = process.env.NODE_ENV !== 'production';
  return pino({
    level,
    base: { service: 'hermieos-mcp' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l' },
          },
        }
      : {}),
  });
}
