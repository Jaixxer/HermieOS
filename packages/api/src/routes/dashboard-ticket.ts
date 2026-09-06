/**
 * Hermes dashboard ticket — mints the WebSocket credential the web app
 * needs to drive the TUI gateway (steer / interrupt / approvals).
 *
 * The Hermes dashboard hosts `/api/ws` — the TUI gateway JSON-RPC over
 * WebSocket. Gated dashboards (non-loopback bind) require a single-use
 * `?ticket=` on the WS upgrade, minted from `POST /api/auth/ws-ticket`
 * with a dashboard session cookie. This route performs the password
 * login (credentials live in HermieOS env, never in the browser) and
 * returns the ticket + WS URL.
 *
 * Env:
 *   HERMES_DASHBOARD_URL             - dashboard origin as seen by the API
 *                                      (compose: http://hermes:9119)
 *   HERMES_DASHBOARD_PUBLIC_URL      - dashboard origin as seen by the web
 *                                      client (desktop/browser). Falls back
 *                                      to HERMES_DASHBOARD_URL.
 *                                      (compose with published port:
 *                                       http://localhost:9119)
 *   HERMES_DASHBOARD_USERNAME        - basic-auth username
 *   HERMES_DASHBOARD_PASSWORD        - basic-auth password
 */
import type { FastifyInstance } from 'fastify';
import { Unauthorized, ServiceUnavailable, sendError } from '../errors.js';

interface TicketResponse {
  wsUrl: string;
  ticket: string;
  provider: string;
}

export function registerDashboardTicketRoutes(app: FastifyInstance): void {
  // POST /hermes/dashboard-ticket — login once, mint a single-use WS
  // ticket for the TUI gateway control channel.
  app.post('/hermes/dashboard-ticket', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }

    const baseUrl = (process.env.HERMES_DASHBOARD_URL ?? '').replace(/\/+$/, '');
    const publicUrl = (process.env.HERMES_DASHBOARD_PUBLIC_URL ?? baseUrl).replace(/\/+$/, '');
    const username = process.env.HERMES_DASHBOARD_USERNAME ?? '';
    const password = process.env.HERMES_DASHBOARD_PASSWORD ?? '';

    if (!baseUrl || !publicUrl || !username || !password) {
      const missing = [
        !baseUrl && 'HERMES_DASHBOARD_URL',
        !publicUrl && 'HERMES_DASHBOARD_PUBLIC_URL',
        !username && 'HERMES_DASHBOARD_USERNAME',
        !password && 'HERMES_DASHBOARD_PASSWORD',
      ]
        .filter(Boolean)
        .join(', ');
      return sendError(
        reply,
        new ServiceUnavailable(
          `Dashboard gateway is not configured (stage=config; missing: ${missing})`,
        ),
        String(req.id),
      );
    }

    try {
      const ticket = await mintTicket(baseUrl, username, password);
      // The WebSocket URL the BROWSER must dial — the public origin, not
      // the compose-internal hostname.
      const wsUrl = `${publicUrl.replace(/^http/, 'ws')}/api/ws`;
      const payload: TicketResponse = { wsUrl, ticket, provider: 'basic' };
      return reply.send(payload);
    } catch (e) {
      const stage = e instanceof TicketStageError ? e.stage : 'unreachable';
      const detail = e instanceof Error ? e.message : String(e);
      app.log.error({ err: e, url: baseUrl, stage }, 'dashboard ticket mint failed');
      return sendError(
        reply,
        new ServiceUnavailable(`Hermes dashboard gateway failed (stage=${stage}): ${detail}`),
        String(req.id),
      );
    }
  });
}

class TicketStageError extends Error {
  readonly stage: 'unreachable' | 'login' | 'ticket';
  constructor(stage: 'unreachable' | 'login' | 'ticket', message: string) {
    super(message);
    this.name = 'TicketStageError';
    this.stage = stage;
  }
}

async function readBodySnippet(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

async function mintTicket(baseUrl: string, username: string, password: string): Promise<string> {
  // 1. Password login — the response sets the session cookie we need
  //    for the ticket endpoint. Node's fetch has no cookie jar, so we
  //    carry the Set-Cookie headers manually. (The auth router is
  //    mounted at the dashboard root: /auth/password-login.)
  let loginRes: Response;
  try {
    loginRes = await fetch(`${baseUrl}/auth/password-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'basic', username, password, next: '' }),
    });
  } catch (e) {
    throw new TicketStageError(
      'unreachable',
      `connect to ${baseUrl} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!loginRes.ok) {
    const snippet = await readBodySnippet(loginRes);
    throw new TicketStageError(
      'login',
      `dashboard login failed: HTTP ${loginRes.status}${snippet ? ` — ${snippet}` : ''}`,
    );
  }
  const cookies = loginRes.headers.getSetCookie?.() ?? [];
  if (cookies.length === 0) {
    throw new TicketStageError('login', 'dashboard login returned no session cookie');
  }
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');

  // 2. Mint the single-use WS ticket with the session cookie.
  let ticketRes: Response;
  try {
    ticketRes = await fetch(`${baseUrl}/api/auth/ws-ticket`, {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: '{}',
    });
  } catch (e) {
    throw new TicketStageError(
      'unreachable',
      `ws-ticket request to ${baseUrl} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!ticketRes.ok) {
    const snippet = await readBodySnippet(ticketRes);
    throw new TicketStageError(
      'ticket',
      `ws-ticket failed: HTTP ${ticketRes.status}${snippet ? ` — ${snippet}` : ''}`,
    );
  }
  const body = (await ticketRes.json()) as { ticket?: string };
  if (!body.ticket) {
    throw new TicketStageError('ticket', 'ws-ticket returned no ticket');
  }
  return body.ticket;
}
