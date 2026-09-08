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

/**
 * Rehost a configured loopback URL to the origin the client actually used
 * to reach this API. When HERMES_DASHBOARD_PUBLIC_URL is localhost/127.0.0.1
 * (the default single-host setup), a phone on the LAN would otherwise receive
 * ws://localhost:9119 and try to dial ITSELF. We swap the host for the
 * X-Forwarded-Host / Host header of the inbound request, preserving scheme
 * (X-Forwarded-Proto aware) and the configured port.
 */
export function rehostForClient(
  configuredUrl: string,
  req: { headers: Record<string, string | string[] | undefined>; protocol: string },
): string {
  try {
    const u = new URL(configuredUrl);
    const host = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname) ? null : u.hostname;
    if (host) return configuredUrl; // explicit public URL — trust it (e.g. subdomains)
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ??
      req.protocol;
    const xfh = req.headers['x-forwarded-host'];
    const hostHeaderRaw: unknown = Array.isArray(xfh) ? xfh[0] : xfh ?? req.headers.host;
    const hostHeader = typeof hostHeaderRaw === 'string' ? hostHeaderRaw : '';
    const hostOnly = hostHeader.split(':')[0] || '';
    if (!hostOnly) return configuredUrl;
    const port = u.port ? `:${u.port}` : '';
    return `${proto}://${hostOnly}${port}`;
  } catch {
    return configuredUrl;
  }
}

export function registerDashboardTicketRoutes(app: FastifyInstance): void {
  // POST /hermes/dashboard-ticket — login once, mint a single-use WS
  // ticket for the TUI gateway control channel.
  app.post('/hermes/dashboard-ticket', async (req, reply) => {
    if (!req.user) {
      return sendError(reply, new Unauthorized(), String(req.id));
    }

    const baseUrl = (process.env.HERMES_DASHBOARD_URL ?? '').replace(/\/+$/, '');
    const configuredPublicUrl = (process.env.HERMES_DASHBOARD_PUBLIC_URL ?? baseUrl).replace(/\/+$/, '');
    const username = process.env.HERMES_DASHBOARD_USERNAME ?? '';
    const password = process.env.HERMES_DASHBOARD_PASSWORD ?? '';

    if (!baseUrl || !configuredPublicUrl || !username || !password) {
      const missing = [
        !baseUrl && 'HERMES_DASHBOARD_URL',
        !configuredPublicUrl && 'HERMES_DASHBOARD_PUBLIC_URL',
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

    // The WS URL the BROWSER must dial. HERMES_DASHBOARD_PUBLIC_URL
    // should be the dashboard origin as seen by the client (e.g.
    // https://hermes-ws.example.com). When it's left at the loopback
    // default (localhost/127.0.0.1 — the common single-host setup),
    // rewrite the host to whatever the client used to reach THIS API,
    // so a phone on the LAN gets ws://192.168.1.5:9119 instead of
    // ws://localhost:9119 (which would point at the phone itself).
    const publicUrl = rehostForClient(configuredPublicUrl, req);

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
