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
  /**
   * Status string to return from GET /v1/runs/{id}. Default 'succeeded'.
   * For run-tracking tests, set this to 'started' / 'running' / 'failed'
   * and flip it after a poll to drive the tracker to the next state.
   */
  getRunStatus?: string;
  /**
   * Per-run override map. If a run id is in this map, return its
   * status instead of the default. Allows simulating individual
   * run timelines.
   */
  runStatuses?: Record<string, string>;
  /**
   * If true, GET /v1/runs/{id} returns the per-call state: the
   * first call returns 'started', then 'running', then 'succeeded'.
   * Walks through on every poll. Set getRunStatus to override the
   * terminal state.
   */
  progressOnPoll?: boolean;
  /** Error string returned in the getRun body when status='failed'. */
  runError?: string;
  /**
   * Output string returned in the getRun body on success. Default
   * 'fake output'. Set to '' to simulate a run that returned no
   * summary.
   */
  getRunOutput?: string;
}

export interface FakeHermes {
  app: Hono;
  url: string;
  port: number;
  recorded: RecordedRun[];
  recordedAll: RecordedRequest[];
  /** In-memory session store (id → session). Shared by the /api/sessions routes. */
  sessions: Map<string, Record<string, unknown>>;
  /** In-memory message log per session id (array of stored messages). */
  messages: Map<string, Array<Record<string, unknown>>>;
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
  app.get('/v1/capabilities', (c) =>
    c.json({
      object: 'hermes.api_server.capabilities',
      platform: 'fake-hermes',
      model: 'fake',
      auth: { type: 'bearer', required: true },
      features: {
        chat_completions: true,
        responses_api: true,
        run_submission: true,
        run_status: true,
        run_events_sse: true,
        run_stop: true,
      },
    }),
  );
  const pollCounters = new Map<string, number>();

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
    let status: string;
    if (opts.runStatuses && id in opts.runStatuses) {
      status = opts.runStatuses[id]!;
    } else if (opts.progressOnPoll) {
      const seen = (pollCounters.get(id) ?? 0) + 1;
      pollCounters.set(id, seen);
      const sequence = ['started', 'running', 'succeeded'];
      status = sequence[Math.min(seen - 1, sequence.length - 1)]!;
    } else {
      status = opts.getRunStatus ?? 'succeeded';
    }
    return c.json({
      run_id: id,
      status,
      output: status === 'succeeded' ? (opts.getRunOutput ?? 'fake output') : '',
      error: status === 'failed' ? (opts.runError ?? 'failed') : undefined,
    });
  });

  app.post('/v1/runs/:id/stop', (c) => {
    const id = c.req.param('id');
    recordedAll.push({ path: `/v1/runs/${id}/stop`, method: 'POST', receivedAt: Date.now() });
    return c.json({ status: 'stopping' });
  });

  // ================================================================
  // /api/sessions — the chat surface (used by HermieOS follow-ups)
  // ================================================================

  const sessions = new Map<string, Record<string, unknown>>();
  const messages = new Map<string, Array<Record<string, unknown>>>();

  function sessionRow(id: string): Record<string, unknown> {
    return {
      id,
      object: 'hermes.session',
      source: 'api_server',
      message_count: (messages.get(id) ?? []).filter((m) => m.role !== 'system').length,
      last_active: Math.floor(Date.now() / 1000),
    };
  }

  app.get('/api/sessions', (c) => {
    recordedAll.push({ path: '/api/sessions', method: 'GET', receivedAt: Date.now() });
    const q = c.req.query();
    const source = q['source'];
    let rows = [...sessions.keys()].map(sessionRow);
    if (source) rows = rows.filter((s) => s.source === source);
    const offset = Number(q['offset'] ?? 0) || 0;
    const limit = Number(q['limit'] ?? 100) || 100;
    rows = rows.slice(offset, offset + limit);
    return c.json({ object: 'list', data: rows });
  });

  app.get('/api/sessions/:id', (c) => {
    const id = c.req.param('id');
    recordedAll.push({ path: `/api/sessions/${id}`, method: 'GET', receivedAt: Date.now() });
    const s = sessions.get(id);
    if (!s) return c.json({ object: 'error', message: `session not found: ${id}` }, 404);
    return c.json({ object: 'hermes.session', session: { ...s, ...sessionRow(id) } });
  });

  app.get('/api/sessions/:id/messages', (c) => {
    const id = c.req.param('id');
    recordedAll.push({ path: `/api/sessions/${id}/messages`, method: 'GET', receivedAt: Date.now() });
    if (!sessions.has(id)) return c.json({ object: 'error', message: 'session not found' }, 404);
    return c.json({ object: 'list', session_id: id, data: messages.get(id) ?? [] });
  });

  app.post('/api/sessions', async (c) => {
    recordedAll.push({ path: '/api/sessions', method: 'POST', receivedAt: Date.now() });
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body['id'] === 'string' ? body['id'] : `sess_${randomBytes(8).toString('hex')}`;
    if (sessions.has(id)) {
      return c.json({ object: 'error', message: `session already exists: ${id}` }, 409);
    }
    const row: Record<string, unknown> = {
      ...sessionRow(id),
      title: body['title'],
      model: body['model'],
      source: body['source'] ?? 'api_server',
    };
    sessions.set(id, row);
    messages.set(id, []);
    return c.json({ object: 'hermes.session', session: row });
  });

  app.patch('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    recordedAll.push({ path: `/api/sessions/${id}`, method: 'PATCH', receivedAt: Date.now() });
    const s = sessions.get(id);
    if (!s) return c.json({ object: 'error', message: 'session not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body['title'] !== undefined) s['title'] = body['title'];
    return c.json({ object: 'hermes.session', session: { ...s, ...sessionRow(id) } });
  });

  app.delete('/api/sessions/:id', (c) => {
    const id = c.req.param('id');
    recordedAll.push({ path: `/api/sessions/${id}`, method: 'DELETE', receivedAt: Date.now() });
    sessions.delete(id);
    messages.delete(id);
    return c.json({ object: 'hermes.session.deleted', session_id: id });
  });

  app.post('/api/sessions/:id/chat', async (c) => {
    const id = c.req.param('id');
    recordedAll.push({ path: `/api/sessions/${id}/chat`, method: 'POST', receivedAt: Date.now() });
    if (!sessions.has(id)) return c.json({ object: 'error', message: 'session not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { message?: string; model?: string };
    const message = body['message'] ?? '';
    const list = messages.get(id) ?? [];
    list.push({ id: `user_${list.length}`, session_id: id, role: 'user', content: message, timestamp: Math.floor(Date.now() / 1000) });
    const assistant = { id: `asst_${list.length}`, session_id: id, role: 'assistant', content: `echo: ${message}`, timestamp: Math.floor(Date.now() / 1000) };
    list.push(assistant);
    messages.set(id, list);
    return c.json({
      object: 'hermes.session.chat.completion',
      session_id: id,
      message: { role: 'assistant', content: assistant.content },
    });
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
    sessions,
    messages,
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
