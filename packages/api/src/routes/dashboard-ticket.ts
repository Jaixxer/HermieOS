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
      return sendError(
        reply,
        new ServiceUnavailable(
          'Dashboard gateway is not configured (HERMES_DASHBOARD_URL / HERMES_DASHBOARD_PUBLIC_URL / HERMES_DASHBOARD_USERNAME / HERMES_DASHBOARD_PASSWORD)',
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
      app.log.error({ err: e, url: baseUrl }, 'dashboard ticket mint failed');
      return sendError(
        reply,
        new ServiceUnavailable('Could not reach the Hermes dashboard gateway'),
        String(req.id),
      );
    }
  });
}

async function mintTicket(baseUrl: string, username: string, password: string): Promise<string> {
  // 1. Password login — the response sets the session cookie we need
  //    for the ticket endpoint. Node's fetch has no cookie jar, so we
  //    carry the Set-Cookie headers manually. (The auth router is
  //    mounted at the dashboard root: /auth/password-login.)
  const loginRes = await fetch(`${baseUrl}/auth/password-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'basic', username, password, next: '' }),
  });
  if (!loginRes.ok) {
    throw new Error(`dashboard login failed: HTTP ${loginRes.status}`);
  }
  const cookies = loginRes.headers.getSetCookie?.() ?? [];
  if (cookies.length === 0) {
    throw new Error('dashboard login returned no session cookie');
  }
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');

  // 2. Mint the single-use WS ticket with the session cookie.
  const ticketRes = await fetch(`${baseUrl}/api/auth/ws-ticket`, {
    method: 'POST',
    headers: { cookie: cookieHeader },
    body: '{}',
  });
  if (!ticketRes.ok) {
    throw new Error(`ws-ticket failed: HTTP ${ticketRes.status}`);
  }
  const body = (await ticketRes.json()) as { ticket?: string };
  if (!body.ticket) {
    throw new Error('ws-ticket returned no ticket');
  }
  return body.ticket;
}
