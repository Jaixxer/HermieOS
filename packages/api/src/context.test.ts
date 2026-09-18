import { describe, expect, it, vi } from 'vitest';

// Count every pino instance construction in this module graph.
const { pinoSpy } = vi.hoisted(() => ({ pinoSpy: vi.fn() }));

vi.mock('pino', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const realDefault = (actual.default ?? actual) as unknown as {
    (...args: unknown[]): unknown;
    stdTimeFunctions?: unknown;
  };
  const wrapped = (...args: unknown[]): unknown => {
    pinoSpy();
    return realDefault(...args);
  };
  // Keep statics (pino.stdTimeFunctions) working on the wrapper.
  return { ...actual, default: Object.assign(wrapped, realDefault) };
});

/**
 * Regression guard for the logger leak.
 *
 * A pino instance built with a `transport` (pino-pretty) eagerly spawns a
 * worker thread and a 4 MB SharedArrayBuffer per instance. buildContext() runs
 * in the onRequest hook, so constructing a logger there leaked a thread per
 * request: the API reached ~1.9 GB RSS and was OOM-killed after ~17h.
 *
 * These tests fail if anyone reintroduces per-request logger construction.
 */
describe('per-request logger construction', () => {
  it('createLogger()/getLogger() return one shared instance', async () => {
    const { createLogger, getLogger } = await import('./logger.js');
    expect(createLogger()).toBe(getLogger());
    expect(getLogger()).toBe(getLogger());
  });

  it('buildContext() builds no pino instance per request', async () => {
    const { buildContext } = await import('./context.js');

    buildContext('warmup'); // let the singleton exist first
    const constructionsBefore = pinoSpy.mock.calls.length;

    for (let i = 0; i < 50; i++) {
      const ctx = buildContext(`req-${i}`);
      expect(ctx.requestId).toBe(`req-${i}`);
      expect(typeof ctx.log.info).toBe('function');
    }

    // 50 requests must add zero pino instances (and therefore zero worker
    // threads and zero 4 MB shared buffers).
    expect(pinoSpy.mock.calls.length).toBe(constructionsBefore);
  });

  it('each request gets a distinct child logger bound to its request id', async () => {
    const { buildContext } = await import('./context.js');
    const a = buildContext('req-a');
    const b = buildContext('req-b');
    expect(a.log).not.toBe(b.log);
    expect(a.log.bindings().request_id).toBe('req-a');
    expect(b.log.bindings().request_id).toBe('req-b');
  });
});
