/**
 * TuiGateway — WebSocket JSON-RPC client for the Hermes TUI gateway.
 *
 * The Hermes dashboard hosts `/api/ws`, which speaks the TUI gateway
 * protocol (newline-delimited JSON-RPC). It exposes the primitives the
 * sync chat API cannot: mid-run `session.steer`, real `session.interrupt`,
 * and `approval.respond` for dangerous commands.
 *
 * Connection flow: the app mints a single-use ticket via
 * `api.dashboardTicket()` (the HermieOS server performs the dashboard
 * login), then opens `ws://…/api/ws?ticket=<ticket>`. The gateway emits
 * `gateway.ready` on accept.
 *
 * Events (`method: "event"` frames) are dispatched to the registered
 * listener: `message.delta`, `message.complete`, `tool.*`,
 * `approval.request`, `clarify.request`, `sudo.request`, `gateway.ready`.
 */

export interface GatewayEvent {
  type: string;
  payload: Record<string, unknown>;
}

type Listener = (event: GatewayEvent) => void;

const GATEWAY_READY_TIMEOUT_MS = 8_000;

export class TuiGateway {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listener: Listener | null = null;
  ready = false;

  /** Open the gateway socket and wait for `gateway.ready`. */
  connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        resolve();
        return;
      }
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        reject(e as Error);
        return;
      }
      this.ws = ws;

      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          this.close();
          reject(new Error('gateway.ready timeout'));
        }
      }, GATEWAY_READY_TIMEOUT_MS);

      ws.onopen = () => {
        /* gateway.ready arrives as the first frame */
      };
      ws.onmessage = (ev: MessageEvent) => {
        let frame: unknown;
        try {
          frame = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        const msg = frame as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message ?? 'rpc error'));
          else p.resolve(msg.result);
          return;
        }
        if (msg.method === 'event' && msg.params?.type === 'gateway.ready') {
          this.ready = true;
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            resolve();
          }
          this.emit(msg.params as unknown as GatewayEvent);
          return;
        }
        if (msg.method === 'event' && msg.params) {
          this.emit(msg.params as unknown as GatewayEvent);
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error('gateway websocket error'));
        }
      };
      ws.onclose = () => {
        this.ready = false;
      };
    });
  }

  onEvent(listener: Listener): void {
    this.listener = listener;
  }

  private emit(event: GatewayEvent): void {
    this.listener?.(event);
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) {
        reject(new Error('gateway not connected'));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  // -- gateway methods ---------------------------------------------------

  createSession(): Promise<{ session_id: string; stored_session_id: string }> {
    return this.request('session.create', {});
  }

  submit(sessionId: string, prompt: string): Promise<{ status: string }> {
    return this.request('prompt.submit', { session_id: sessionId, text: prompt });
  }

  /** Inject a note mid-run — lands on the next tool result. */
  steer(sessionId: string, text: string): Promise<{ status: string }> {
    return this.request('session.steer', { session_id: sessionId, text });
  }

  /** Hard interrupt — cancels the running turn server-side. */
  interrupt(sessionId: string): Promise<{ status: string }> {
    return this.request('session.interrupt', { session_id: sessionId });
  }

  /** Generic gateway prompt response. `kind` = event type minus
   *  `.request` (clarify, sudo, secret, terminal.read, approval…). */
  respond(kind: string, params: Record<string, unknown>): Promise<unknown> {
    return this.request(`${kind}.respond`, params);
  }

  /** Resolve a pending approval: 'once' | 'session' | 'always' | 'deny'. */
  approve(sessionId: string, choice: string, all = false): Promise<{ resolved: number }> {
    return this.request('approval.respond', { session_id: sessionId, choice, all });
  }

  /** Answer a clarify question (Hermes asks how to proceed). */
  clarify(requestId: string, answer: string): Promise<{ status: string }> {
    return this.request('clarify.respond', { request_id: requestId, answer });
  }

  /** Supply the sudo password for a pending sudo.request. */
  sudo(requestId: string, password: string): Promise<{ status: string }> {
    return this.request('sudo.respond', { request_id: requestId, password });
  }

  /** Supply a secret value for a pending secret.request. */
  secret(requestId: string, value: string): Promise<{ status: string }> {
    return this.request('secret.respond', { request_id: requestId, value });
  }

  close(): void {
    this.ready = false;
    this.ws?.close();
    this.ws = null;
    for (const p of this.pending.values()) p.reject(new Error('gateway closed'));
    this.pending.clear();
  }
}
