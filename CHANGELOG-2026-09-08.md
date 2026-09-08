# HermieOS — Change Log (2026-09-08 session)

All changes made to the HermieOS repo and the host in this session, in detail.
Repo base: `main` @ `0da6f63` ("fix: setup bring-up blockers from Sep 6 field report"),
now with 3 local commits on top.

---

## 1. SECURITY — SSE auth no longer puts the MCP token in URLs
Commit: `2ffd857` — `fix(security): replace MCP-token-in-URL SSE auth with short-lived single-use tickets`

### Problem
`EventSource` cannot send an `Authorization` header, so the web client was
authenticating `GET /events` by appending the **permanent MCP token** as a query
parameter: `/events?token=mcp_…`.

That token then traveled through:
- server request logs (verified: it appeared verbatim in the API log),
- reverse-proxy logs (Cloudflare / nginx access logs),
- browser history / dev tools.

The MCP token is long-lived (stored in DB, no expiry) and is the account's root
credential (it is what the Hermes profile uses to talk to the MCP server). One log
leak = permanent account compromise.

### Change (server — `packages/api`)
1. **New file `src/sse-tickets.ts`** — in-memory ticket store:
   - `mintSseTicket(userId)` — returns a 64-char base64url ticket bound to a user,
     TTL **60 seconds**, single-use.
   - `consumeSseTicket(ticket)` — validates, expires, marks consumed; returns the
     userId the ticket was minted for.
   - Same single-process model as the SSE bus (no Redis/LISTEN-NOTIFY involved).
2. **`src/routes/events.ts`** — added route `POST /events/ticket`:
   - Authenticated by the normal path (session cookie or `Authorization: Bearer`),
     returns `{ ticket, ttlSeconds: 60 }`.
   - `GET /events` now accepts `?ticket=` — validates + consumes, binds the stream
     to the ticket's userId. Falls back to the session path (`req.user`) for
     same-origin UIs / tests. Invalid/expired ticket → 401 and stream closed.
3. **`src/auth-middleware.ts`** — removed the query-string (`?token=`) auth branch
   from `getSessionUser` entirely. No route accepts a token in the URL anymore.
4. **`src/events.test.ts`** — rewrote SSE tests to the new contract; added:
   - "rejects a raw MCP token in the query string (security)" → asserts 401,
   - "mints a ticket then opens an SSE stream via ?ticket=",
   - "rejects an SSE stream with a bogus ?ticket=".

### Change (client — `packages/web`, shared by browser + Capacitor + Electron)
The Capacitor (mobile) and Electron (desktop) apps are wrappers around the SAME
`packages/web` source — one change covers all three targets.
5. **`src/api.ts`**:
   - `sseUrl(ticket)` — now requires a ticket, builds `/events?ticket=…`.
   - New `mintSseTicket()` — `POST /events/ticket` via the normal authed `request()`
     helper (bearer header, never in a URL).
6. **`src/sse.ts`** — `useSse` rewritten:
   - mints a fresh ticket before opening the EventSource,
   - on any error (expiry, network drop, server restart) closes the stream and
     re-mints + reconnects (1s / 5s backoff),
   - tickets are single-use, so reconnection always uses a fresh one.

### Verification
- `pnpm --filter @hermieos/api typecheck` — clean.
- `pnpm --filter @hermieos/api exec vitest run src/events.test.ts` — 9/9 pass.
- `pnpm --filter @hermieos/api test:run` — 88/88 pass (11 files), after the
  dashboard-ticket + hermes-info fixes below.
- `pnpm --filter @hermieos/web typecheck` — clean; `test:run` 83/83 pass.
- Live probe against the running API:
  - `POST /events/ticket` (bearer) → 200, ttl 60,
  - `/events?token=whatever` → **401** (old path dead),
  - `/events?ticket=…` → 200 `text/event-stream`, `event: connected` received.

---

## 2. TEST FIX — hermes-info token assertion was stale
Commit: `9c35e55` — `test(api): hermes-info token is the shared gateway key when configured`

### Problem
`GET /me/hermes-info` returns `token: sharedKey || mcpToken`. Once a gateway
`HERMES_API_KEY` is configured (it is — the gateway API server on 8642 requires it),
the route correctly returns the **shared gateway key** (the browser needs that key to
call `/api/sessions`; the gateway has no per-user identity). The test still asserted
`token.startsWith('mcp_')`, which failed whenever a gateway key existed. This was a
test-only failure — app behavior was correct.

### Change
`packages/api/test/hermes-info.test.ts` now asserts the real contract:
- with a configured shared key → token equals that key and `gatewayConfigured === true`,
- without one → token starts with `mcp_`.

Verified: `vitest run test/hermes-info.test.ts` → 3/3 pass; full suite green.

---

## 3. FIX — phone could not reach the dashboard WebSocket (the recurring "nothing connects" bug)
Commit: `7c5a176` — `fix(api): rehost dashboard WS URL to the caller's origin when configured loopback`

### Problem
`POST /hermes/dashboard-ticket` returned `wsUrl: ws://localhost:9119/api/ws`
because `HERMES_DASHBOARD_PUBLIC_URL` defaults to `http://localhost:9119`.

On the phone, `localhost` is the **phone itself** — so the WS control channel
(sessions steering, approvals) could never connect. This is the root cause of the
repeated "still the same shit on phone / nothing is being connected or verified"
reports. The server-side chain (login → ticket → WS upgrade) was verified working;
only the URL handed to the client was unreachable from a phone.

### Change
`packages/api/src/routes/dashboard-ticket.ts` — new exported `rehostForClient()`:
- If the configured public URL is loopback-only (`localhost` / `127.0.0.1` / `[::1]`),
  derive the public host from the inbound request: `X-Forwarded-Host` first, else the
  `Host` header. Scheme honors `X-Forwarded-Proto` (for future HTTPS), port is kept
  from the configured URL (9119).
- If the configured URL is already a non-loopback public URL (e.g. a
  `hermes-ws.example.com` subdomain), it is trusted as-is — that's the future
  subdomain path and nothing changes there.
- Falls back to the configured URL when no caller host is present.

New test file `packages/api/test/dashboard-ticket.test.ts` — 7 cases (subdomain
passthrough, localhost/127.0.0.1/::1 rewrite, X-Forwarded-Host/Proto priority,
no-host fallback). All pass.

### Verification (live)
Probe with a phone-simulated `Host: 192.168.1.5:3101`:
```
wsUrl: ws://192.168.1.5:9119/api/ws
ticket: True
provider: basic
```
Full live chain re-verified: dashboard login 200 → `POST /api/auth/ws-ticket` 200 →
WS upgrade against `192.168.1.5:9119/api/ws?ticket=…` → **HTTP/1.1 101 Switching Protocols**.

---

## 4. OPS — services now run under systemd and start at boot
Files: `~/.config/systemd/user/{hermieos-api,hermieos-mcp,hermes-dashboard}.service`

The API/MCP/dashboard previously ran as session-tied background processes and kept
dying when the spawning session ended (restarted 3+ times this session). Now:

| Service | Port | ExecStart |
|---|---|---|
| `hermieos-api` | 3101 (0.0.0.0) | `pnpm dev:api` in `~/projects/HermieOS`, env from `.env` |
| `hermieos-mcp` | 3002 | `pnpm dev:mcp`, env from `.env` |
| `hermes-dashboard` | 9119 (0.0.0.0) | `hermes dashboard --host 0.0.0.0 --port 9119 --no-open --skip-build` |

- All `Restart=always`, `RestartSec=5`.
- `loginctl enable-linger jaiveer2507` — user units start at boot without a login.
- Postgres (`hermieos-postgres`, Docker) already `RestartPolicy=unless-stopped`.
- Hermes gateway API (8642) already a systemd service (`hermes-gateway.service`).
- Enabled: `systemctl --user enable --now hermieos-api hermieos-mcp hermes-dashboard`
  — verified all three `active` and listening.
- Manage: `systemctl --user status/restart hermieos-api`, logs
  `journalctl --user -u hermieos-api -f`.

Note: systemd user units run under the `jaiveer2507` user manager; they depend on
`docker.service` (Postgres) which is a system unit — ordering is via
`After=`/`Wants=` on the network + docker units, plus `Restart=always` backstop.

---

## Host state summary (unchanged from earlier, for context)
- Postgres :15432 (Docker), API :3101, MCP :3002, dashboard :9119, gateway API :8642.
- Hermes gateway api_server platform enabled via `~/.hermes/config.yaml`
  (`platforms.api_server.enabled=true`, key/host/port/cors), configured through
  `hermes config set` + SIGUSR1 (no sudo needed).
- Dashboard basic auth (`dashboard.basic_auth`) set through `hermes config set`
  (username `hermieos`, password synced with `HERMES_DASHBOARD_PASSWORD`).
- `hermes-agent` checkout is CLEAN upstream (git status clean, no local patches).
  The WS ticket chain works without patches because the dashboard binds 0.0.0.0
  (auth gate engaged → real session after login). Earlier in-session patches to
  `dashboard_auth/routes.py` / `middleware.py` / `web_server.py` were for the
  loopback-bind era and no longer exist on disk; they are NOT needed with the
  current 0.0.0.0 bind.
- Security note from the review: gateway `API_SERVER_KEY` is still the dev
  placeholder (`change-me-local-dev`). Rotate to a strong key before any public
  exposure; the SSE ticket change is done, but the same "rotate before public"
  applies to the dashboard password.

## Verification totals
- API: 11 test files, 88/88 pass (`test:run` with `--no-file-parallelism`).
- Web: 12 test files, 83/83 pass; typecheck clean both packages.
- Live: MCP registration 43 tools, dashboard-ticket → ws-ticket → WS 101 chain,
  SSE ticket mint + stream, old `?token=` rejected.