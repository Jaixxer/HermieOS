import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Pretty (pino-pretty) output is opt-in and dev-only.
 *
 * `pino-pretty` is NOT a free formatter: pino's `transport` option spawns a
 * worker thread (thread-stream) plus a 4 MB SharedArrayBuffer PER LOGGER
 * INSTANCE, allocated eagerly in the constructor, even if nothing is ever
 * logged to it. A logger instance must therefore be created once per process
 * and shared — never per request. See getLogger() below.
 *
 * LOG_PRETTY=0 emits raw JSON to stdout, which is what a supervised service
 * under journald should do (journald stores the line verbatim either way, and
 * JSON keeps the fields greppable).
 */
export function prettyEnabled(): boolean {
  const flag = process.env.LOG_PRETTY;
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export function loggerOptions(): LoggerOptions {
  const level = process.env.LOG_LEVEL ?? 'info';
  return {
    level,
    base: { service: 'hermieos-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(prettyEnabled()
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l' },
          },
        }
      : {}),
  };
}

let singleton: Logger | null = null;

/**
 * The process-wide logger.
 *
 * Memoized on purpose: constructing a pino instance with a `transport` costs a
 * worker thread + a 4 MB SharedArrayBuffer, and pino child loggers share the
 * parent's stream for free. The first call builds the instance; every later
 * call returns the same object.
 *
 * Request-scoped logging must derive from this with `.child()` — see
 * `buildContext()` in context.ts. Do NOT call `pino(...)` per request: that
 * leaks a worker thread per request and was the cause of the API growing to
 * ~1.9 GB RSS and being OOM-killed.
 */
export function getLogger(): Logger {
  if (singleton === null) singleton = pino(loggerOptions());
  return singleton;
}

/**
 * Alias of getLogger(), kept for call sites that just want "a logger".
 * It intentionally returns the shared singleton — it must never build a new
 * pino instance per call.
 */
export function createLogger(): Logger {
  return getLogger();
}

export type { Logger } from 'pino';
