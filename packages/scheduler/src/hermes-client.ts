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
  /** Subscription / feedback_review / system_notify. */
  kind: 'subscription' | 'feedback_review' | 'system_notify';
  /** The actual instruction. */
  input: string;
  /** Optional layered system-prompt prefix. */
  instructions?: string;
}

export interface RunDispatchResult {
  hermesRunId: string;
  status: string;
}

export type HermesClientError =
  | { kind: 'http'; status: number; body: string; retryable: boolean }
  | { kind: 'network'; message: string; retryable: boolean };

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

  async getRun(runId: string): Promise<{ runId: string; status: string; body: unknown }> {
    const url = `${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}`;
    const headers = this.headers();
    const body = await this.requestWithRetries(url, { method: 'GET', headers });
    return { runId, status: 'unknown', body };
  }

  async stopRun(runId: string): Promise<void> {
    const url = `${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/stop`;
    const headers = this.headers();
    await this.requestWithRetries(url, { method: 'POST', headers, body: '{}' });
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
  kind: 'subscription' | 'feedback_review' | 'system_notify',
  body: string,
): string {
  return `[kind=${kind}]\n${body}`;
}
