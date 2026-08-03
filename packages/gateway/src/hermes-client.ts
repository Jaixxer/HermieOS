/**
 * Hermes Agent HTTP API client.
 *
 * Wraps the documented /v1/runs surface:
 *   POST /v1/runs            -> create a run, returns { run_id, status }
 *   GET  /v1/runs/{id}       -> poll status
 *   POST /v1/runs/{id}/stop  -> cancel a run
 *
 * Auth: single bearer token via the Authorization header.
 *
 * Timeouts: every request is bounded by `timeoutMs` (default 10s) using
 * AbortSignal.timeout(). The scheduler enforces a longer run deadline at
 * the run level (SCHEDULER_RUN_DEADLINE_MS) — that is not the same as the
 * HTTP timeout, which is the per-request cap.
 *
 * Retries: only on transient errors (network failure, 5xx, 408, 429).
 * Never on 4xx other than 408/429. Never on a Hermes error response that
 * parses as a valid JSON.
 */
export interface RunDispatchRequest {
  /** Our hermes_runs.id. Hermes echoes it in run state. */
  hermieosRunId: string;
  /** Our user_id. Drives Honcho memory scoping. */
  userId: string;
  /** Subscription / feedback_review / system_notify / ad_hoc. */
  kind: 'subscription' | 'feedback_review' | 'system_notify' | 'ad_hoc';
  /** The actual instruction. */
  input: string;
  /** Optional layered system-prompt prefix. */
  instructions?: string;
}

export interface RunDispatchResult {
  hermesRunId: string;
  status: string;
}

/**
 * Hermes run status, as returned by GET /v1/runs/{id}.
 *
 * Status values (per Hermes docs): "started" | "running" | "completed" |
 * "succeeded" | "failed" | "cancelled" | "stopping".
 */
export interface RunStatus {
  runId: string;
  status: string;
  output?: string;
  error?: string;
  sessionId?: string;
}

export function isTerminalRunStatus(status: string): boolean {
  return (
    status === 'completed' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

export function isSuccessRunStatus(status: string): boolean {
  return status === 'completed' || status === 'succeeded';
}

/**
 * Shape of GET /v1/capabilities. We only need the feature flags.
 */
export interface HermesCapabilities {
  object?: string;
  platform?: string;
  model?: string;
  auth?: { type: string; required: boolean };
  features?: {
    chat_completions?: boolean;
    responses_api?: boolean;
    run_submission?: boolean;
    run_status?: boolean;
    run_events_sse?: boolean;
    run_stop?: boolean;
    [key: string]: boolean | undefined;
  };
  endpoints?: Record<string, string>;
}

export type HermesClientError =
  | { kind: 'http'; status: number; body: string; retryable: boolean }
  | { kind: 'network'; message: string; retryable: boolean };

export interface HermesSession {
  id: string;
  source?: string | null;
  user_id?: string | null;
  model?: string | null;
  title?: string | null;
  preview?: string | null;
  message_count?: number;
  tool_call_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  last_active?: number | null;
  started_at?: number;
}

export interface HermesMessage {
  id: string | number;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_call_id?: string | null;
  tool_calls?: unknown[];
  tool_name?: string | null;
  timestamp?: number | null;
  token_count?: number | null;
  finish_reason?: string | null;
  reasoning?: string | null;
}

export interface HermesMessageList {
  object: 'list';
  session_id: string;
  data: HermesMessage[];
}

export interface HermesChatResult {
  object: 'hermes.session.chat.completion';
  session_id: string;
  message: { role: 'assistant'; content: string };
  usage?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
}

export class HermesHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryable: boolean;
  constructor(status: number, body: string, retryable: boolean) {
    super(`hermes http ${status}: ${body.slice(0, 200)}`);
    this.name = 'HermesHttpError';
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
}

export class HermesNetworkError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(`hermes network: ${message}`);
    this.name = 'HermesNetworkError';
    this.retryable = retryable;
  }
}

export interface HermesClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout in ms. Default 10_000. */
  timeoutMs?: number;
  /** Max retries on transient failure. Default 1 (one extra attempt). */
  maxRetries?: number;
  /** Initial backoff between retries, doubled each attempt. Default 500ms. */
  initialBackoffMs?: number;
  /** Test hook: override fetch (for unit tests). */
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  if (err instanceof HermesHttpError) return err.retryable;
  if (err instanceof HermesNetworkError) return err.retryable;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HermesClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 1;
    this.initialBackoffMs = opts.initialBackoffMs ?? 500;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...extra,
    };
  }

  private buildSessionHeaders(req: RunDispatchRequest): Record<string, string> {
    // session_id is the run's transcript scope; session_key is the
    // memory scope. The MCP server URL and per-user token live in Hermes's
    // per-user profile, not here.
    return {
      'mcp-session-id': `hermieos-run-${req.hermieosRunId}`,
      'x-hermes-session-key': `hermieos:user-${req.userId}`,
    };
  }

  /**
   * Dispatch a run. Throws HermesHttpError or HermesNetworkError on
   * failure. Caller decides whether to retry (we retry transient errors
   * automatically up to maxRetries).
   */
  async dispatchRun(req: RunDispatchRequest): Promise<RunDispatchResult> {
    const url = `${this.baseUrl}/v1/runs`;
    const body = JSON.stringify({
      input: req.input,
      ...(req.instructions ? { instructions: req.instructions } : {}),
      session_id: `hermieos-run-${req.hermieosRunId}`,
      session_key: `hermieos:user-${req.userId}`,
    });
    const headers = {
      ...this.headers(),
      ...this.buildSessionHeaders(req),
    };
    const res = await this.requestWithRetries(url, { method: 'POST', headers, body });
    const parsed = res as { run_id?: string; status?: string };
    if (!parsed.run_id || !parsed.status) {
      throw new HermesHttpError(200, JSON.stringify(res), false);
    }
    return { hermesRunId: parsed.run_id, status: parsed.status };
  }

  /**
   * Poll the run's current status. The shape returned by Hermes is
   * { id, status, output?, session_id?, ... }. We extract the bits
   * the run-tracker needs.
   */
  async getRun(runId: string): Promise<RunStatus> {
    const url = `${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}`;
    const headers = this.headers();
    const body = await this.requestWithRetries(url, { method: 'GET', headers });
    const parsed = body as {
      run_id?: string;
      id?: string;
      status?: string;
      output?: string;
      error?: string;
      session_id?: string;
    };
    return {
      runId: parsed.run_id ?? parsed.id ?? runId,
      status: parsed.status ?? 'unknown',
      output: parsed.output,
      error: parsed.error,
      sessionId: parsed.session_id,
    };
  }

  async stopRun(runId: string): Promise<void> {
    const url = `${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/stop`;
    const headers = this.headers();
    await this.requestWithRetries(url, { method: 'POST', headers, body: '{}' });
  }

  /**
   * Probe the gateway. Returns the parsed capabilities body. Does
   * NOT retry — this is called once at startup and we want a hard
   * fail if Hermes isn't reachable.
   */
  async getCapabilities(): Promise<HermesCapabilities> {
    const url = `${this.baseUrl}/v1/capabilities`;
    const headers = this.headers();
    const body = await this.requestWithRetries(url, { method: 'GET', headers });
    return body as HermesCapabilities;
  }

  // ==================================================================
  // Sessions + chat (the /api/sessions surface)
  //
  // Sessions are owned by the Hermes gateway's own store. HermieOS
  // does not mirror them; it references them by id (e.g. a finding
  // conversation lives at `finding-<objectId>`).
  // ==================================================================

  /**
   * List persisted sessions. `source` filters by gateway/source
   * (api_server, cli, telegram, …).
   */
  async listSessions(params?: {
    limit?: number;
    offset?: number;
    source?: string;
  }): Promise<{ data: HermesSession[] }> {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) search.set('limit', String(params.limit));
    if (params?.offset !== undefined) search.set('offset', String(params.offset));
    if (params?.source) search.set('source', params.source);
    const qs = search.toString();
    const url = `${this.baseUrl}/api/sessions${qs ? `?${qs}` : ''}`;
    return (await this.requestWithRetries(url, { method: 'GET', headers: this.headers() })) as {
      data: HermesSession[];
    };
  }

  /** Fetch one session's metadata. */
  async getSession(sessionId: string): Promise<{ object: string; session: HermesSession }> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`;
    return (await this.requestWithRetries(url, { method: 'GET', headers: this.headers() })) as {
      object: string;
      session: HermesSession;
    };
  }

  /** Read all messages for a session. */
  async getMessages(sessionId: string): Promise<HermesMessageList> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`;
    return (await this.requestWithRetries(url, { method: 'GET', headers: this.headers() })) as HermesMessageList;
  }

  /**
   * Create an empty session. `id` is honored when supplied — HermieOS
   * uses deterministic ids (`finding-<objectId>`) so a conversation
   * resumes without a lookup table. Some Hermes versions reject
   * `title` on create; callers should fall back to renameSession.
   */
  async createSession(body: {
    id?: string;
    model?: string;
    source?: string;
    title?: string;
  }): Promise<{ object: string; session: HermesSession }> {
    const url = `${this.baseUrl}/api/sessions`;
    return (await this.requestWithRetries(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })) as { object: string; session: HermesSession };
  }

  /** Rename a session. Empty title clears it. */
  async renameSession(
    sessionId: string,
    title: string,
  ): Promise<{ object: string; session: HermesSession }> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`;
    return (await this.requestWithRetries(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ title }),
    })) as { object: string; session: HermesSession };
  }

  /** Delete a session. */
  async deleteSession(sessionId: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`;
    return this.requestWithRetries(url, { method: 'DELETE', headers: this.headers() });
  }

  /**
   * Send one user turn to a session and get the assistant reply.
   *
   * Deliberately NO retry on transient errors: a retried POST could
   * double-send the user's message. The caller surfaces the error and
   * the client re-sends on user action.
   */
  async chat(
    sessionId: string,
    body: {
      message: string;
      model?: string;
      system_message?: string;
      model_options?: Record<string, unknown>;
    },
  ): Promise<HermesChatResult> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/chat`;
    return (await this.requestOnce(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })) as HermesChatResult;
  }

  private async requestWithRetries(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<unknown> {
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt <= this.maxRetries) {
      try {
        return await this.requestOnce(url, init);
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt === this.maxRetries) throw err;
        const wait = this.initialBackoffMs * 2 ** attempt;
        await sleep(wait);
        attempt += 1;
      }
    }
    throw lastErr;
  }

  private async requestOnce(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // AbortError from AbortSignal.timeout is a network-class error.
      throw new HermesNetworkError(message, true);
    }
    const text = await res.text();
    const isJson = (res.headers.get('content-type') ?? '').includes('json');
    let parsed: unknown = text;
    if (isJson && text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (res.ok) return parsed;
    const retryable = RETRYABLE_STATUS.has(res.status);
    throw new HermesHttpError(res.status, text, retryable);
  }
}

export function buildRunInstruction(
  kind: 'subscription' | 'feedback_review' | 'system_notify' | 'ad_hoc',
  body: string,
): string {
  return `[kind=${kind}]\n${body}`;
}
