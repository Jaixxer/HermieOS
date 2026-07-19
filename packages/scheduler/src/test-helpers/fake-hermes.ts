/**
 * Fake Hermes HTTP server for tests.
 *
 * Records every dispatchRun call. Returns 200 + a fake run id by
 * default. Can be configured to return failures (transient or
 * persistent) and to record GET /v1/runs/{id} / POST /stop calls.
 *
 * Spins up a real Node HTTP server so the test exercises AbortSignal.timeout
 * and the full HTTP stack via the HermesClient.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Hono } from 'hono';

export interface RecordedRun {
  hermieosRunId: string;
  userId: string;
  kind: string;
  input: string;
  instructions: string | undefined;
  sessionId: string | undefined;
  sessionKey: string | undefined;
  authorization: string | undefined;
  receivedAt: number;
}

export interface RecordedRequest {
  path: string;
  method: string;
  receivedAt: number;
}

export interface FakeHermesOptions {
  /** Status code to return from POST /v1/runs. Default 200. */
  runStatus?: number;
  /** Body to return. Default { run_id, status: 'started' }. */
  runBody?: (req: { input: string; sessionKey: string }) => Record<string, unknown>;
  /** If set, fail the first N dispatchRun calls (in order) with 503. */
  transientFailures?: number;
  /** If true, every dispatchRun returns 503. */
  alwaysFail?: boolean;
}

export interface FakeHermes {
  app: Hono;
  url: string;
  port: number;
  recorded: RecordedRun[];
  recordedAll: RecordedRequest[];
  setMode(opts: Partial<FakeHermesOptions>): void;
  close(): Promise<void>;
}

export async function makeFakeHermes(initial: FakeHermesOptions = {}): Promise<FakeHermes> {
  const recorded: RecordedRun[] = [];
  const recordedAll: RecordedRequest[] = [];
  let opts: FakeHermesOptions = { ...initial };
  let callIndex = 0;

  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true, fake: true }));

  app.post('/v1/runs', async (c) => {
    const auth = c.req.header('authorization') ?? undefined;
    const body = (await c.req.json().catch(() => ({}))) as {
      input?: string;
      instructions?: string;
      session_id?: string;
      session_key?: string;
    };
    const idx = callIndex++;
    recorded.push({
      hermieosRunId: body.session_id ?? '',
      userId: body.session_key ?? '',
      kind: 'unknown',
      input: body.input ?? '',
      instructions: body.instructions,
      sessionId: body.session_id,
      sessionKey: body.session_key,
      authorization: auth,
      receivedAt: Date.now(),
    });
    recordedAll.push({ path: '/v1/runs', method: 'POST', receivedAt: Date.now() });

    if (opts.alwaysFail) return c.json({ error: 'always failing' }, 503 as never);
    if (opts.transientFailures && idx < opts.transientFailures) {
      return c.json({ error: 'transient' }, 503 as never);
    }
    const status = opts.runStatus ?? 200;
    if (status >= 400) return c.json({ error: 'configured failure' }, status as never);
    const runId = `run_${randomBytes(6).toString('hex')}`;
    const bodyOut = opts.runBody
      ? opts.runBody({ input: body.input ?? '', sessionKey: body.session_key ?? '' })
      : { run_id: runId, status: 'started' };
    return c.json(bodyOut, status as never);
  });

  app.get('/v1/runs/:id', (c) => {
    const id = c.req.param('id');
    recordedAll.push({ path: `/v1/runs/${id}`, method: 'GET', receivedAt: Date.now() });
    return c.json({ run_id: id, status: 'succeeded', output: 'fake' });
  });

  app.post('/v1/runs/:id/stop', (c) => {
    const id = c.req.param('id');
    recordedAll.push({ path: `/v1/runs/${id}/stop`, method: 'POST', receivedAt: Date.now() });
    return c.json({ status: 'stopping' });
  });

  const server = await new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const s = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = `http://${req.headers.host ?? '127.0.0.1'}${req.url ?? '/'}`;
      const method = req.method ?? 'GET';
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
      }
      let body: Buffer | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        body = Buffer.concat(chunks);
      }
      const honoRes = await app.fetch(new Request(url, { method, headers, body }));
      res.statusCode = honoRes.status;
      honoRes.headers.forEach((v, k) => res.setHeader(k, v));
      const honoBody = await honoRes.arrayBuffer();
      res.end(Buffer.from(honoBody));
    });
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        close: () =>
          new Promise<void>((r) => {
            s.close(() => r());
          }),
      });
    });
  });

  return {
    app,
    url: `http://127.0.0.1:${server.port}`,
    port: server.port,
    recorded,
    recordedAll,
    setMode(next) {
      if (Object.keys(next).length === 0) {
        opts = {};
        callIndex = 0;
      } else {
        opts = { ...opts, ...next };
      }
    },
    close: () => server.close(),
  };
}
