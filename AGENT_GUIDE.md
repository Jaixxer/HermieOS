# HermieOS Agent Guide

This guide is for agents and maintainers working in the public HermieOS repository. It covers both end-to-end setup and safe code changes. Read the repository files and existing implementation before changing behavior. Keep changes small, testable, and compatible with the current desktop and mobile surfaces.

## Project Shape

HermieOS is a persistence and presentation layer around an existing Hermes Agent. It does not bundle its own agent.

- `packages/api` is the Fastify REST and SSE API on port `3001`.
- `packages/mcp` is the MCP server Hermes uses on port `3002`.
- `packages/scheduler` dispatches background work to Hermes.
- `packages/db` contains Drizzle schema and migrations.
- `packages/domain` contains shared schemas, constants, and the shared `.env` loader (`loadRootEnv`).
- `packages/gateway` contains the Hermes HTTP client.
- `packages/skills` contains the HermieOS skills deployed to Hermes.
- `packages/web` contains the React client, Electron shell, and Capacitor Android project.
- `scripts/install.sh` is the interactive installer.
- `docker-compose.yml` runs the local Postgres, API, MCP, scheduler, search, and optional real Hermes stack.
- `LICENSE` is the MIT license. Preserve it in public changes.

## Development Rules

- Inspect related code, tests, and package scripts before editing.
- Preserve the existing editorial desktop design and responsive mobile behavior.
- Keep API endpoints configurable; do not hardcode a deployment host or token.
- Never put credentials, database dumps, runtime logs, generated packages, or local configuration in Git.
- Keep `.env` local. Use `.env.example` with placeholders for documented configuration.
- Do not edit generated directories as source. Build outputs belong in ignored directories or GitHub Releases.
- Do not use destructive Git commands such as `reset --hard`, force-push, or history rewrites without explicit approval.
- Do not commit unrelated worktree changes.
- Add or update focused tests when behavior changes.
- Hand-written SQL migrations (`packages/db/drizzle/*.sql`) must be idempotent-safe: use `IF NOT EXISTS` for anything that an earlier migration may already have created, and never re-add an enum value or constraint that an earlier migration adds. Migration failures abort the whole chain silently (drizzle-kit swallows the Postgres error) and leave an empty `drizzle.__drizzle_migrations` journal.

## Deployment Modes

HermieOS attaches to a Hermes Agent you already run. There are FOUR independent axes; pick one per axis and combine freely. The interactive installer (`./scripts/install.sh`) encodes exactly this matrix and writes the matching `.env`.

| Axis | Options | Decided by |
|---|---|---|
| Where Hermes runs | `local` (systemwide CLI + HTTP API) / `docker` (container) / `remote` (another machine) | installer Q1 ("Where is Hermes installed?") |
| Where the HermieOS MCP server runs | `host` (process on the HermieOS host, port 3002) / `docker` (container on Hermes's Docker network) | installer Q4 |
| Where Postgres runs | `docker` (compose, host port 15432) / existing instance (any port) | installer Q5 |
| Where HermieOS services run | host processes (`pnpm dev:*`) / containers (`docker compose`) | how you start the stack |

### The four mode URLs that must agree

Four URLs must point at each other. Get any one wrong and the app "connects" but chat/feed/scheduling silently dead-end:

1. `HERMES_GATEWAY_URL` — where the **scheduler/API** reach Hermes' HTTP API (`/v1/runs`, `/api/sessions`). Loopback for local Hermes, `http://hermes:8642` inside compose, `https://hermes.example.com:8642` for remote.
2. `HERMES_PUBLIC_URL` — where the **browser/phone** reaches Hermes' API server directly for chat. Same machine as the API: can be omitted (derived). Phone on LAN: must be the LAN address, e.g. `http://192.168.1.7:8642`.
3. `HERMES_MCP_URL` — where **Hermes** reaches the HermieOS MCP server. Local Hermes: `http://127.0.0.1:3002/mcp`. Hermes in Docker: `http://host.docker.internal:3002/mcp` (MCP mode `host`) or `http://hermieos-mcp:3002/mcp` (MCP mode `docker`). Remote Hermes: a URL reachable FROM the remote box (usually your LAN/VPN address, NOT 127.0.0.1).
4. `MCP_PUBLIC_URL` — where anything else (tools, debugging) reaches the MCP server.

### Port map (defaults)

| Port | Service | Notes |
|---|---|---|
| 3001 | HermieOS API (REST + SSE) | host process or `hermieos-api` container |
| 3002 | HermieOS MCP server | host process or `hermieos-mcp` container |
| 15432 | Postgres (compose host port) | container listens on 5432; host sees 15432 to avoid clashing with a host Postgres |
| 8642 | Hermes API server (`hermes gateway run`) | serves `/v1/*` AND `/api/sessions` (chat). NOT started by `hermes-gateway.service`'s messaging side alone |
| 9119 | Hermes dashboard (TUI gateway `/api/ws`) | steer / interrupt / approvals; compose `hermes` service or `hermes dashboard` on the host |
| 4100 | fake Hermes (tests + demo) | compose default profile only |
| 8888 | SearXNG (host) → 8080 (container) | web search for Hermes |
| 5173 | Vite dev server (web client) | proxies `/api/*` to 3001 in dev |

### Mode A — Everything local (systemwide Hermes)

The common personal-machine setup. Hermes installed on the host (`pipx`/system install), HermieOS services as host processes.

```bash
./scripts/install.sh          # answer 1 (local Hermes), host MCP, docker Postgres
pnpm dev:api & pnpm dev:mcp & pnpm dev:scheduler & pnpm dev:web
```

Resulting `.env` (managed keys):

```ini
HERMES_GATEWAY_URL=http://127.0.0.1:8642
HERMES_LOCATION=local
HERMIEOS_MCP_MODE=host
HERMES_MCP_URL=http://127.0.0.1:3002/mcp
MCP_PUBLIC_URL=http://127.0.0.1:3002/mcp
DATABASE_URL=postgres://hermieos:hermieos@localhost:15432/hermieos
HERMES_HOME=/home/<you>/.hermes
HERMES_DASHBOARD_URL=http://127.0.0.1:9119
HERMES_DASHBOARD_PUBLIC_URL=http://127.0.0.1:9119
```

Hermes side needs the dashboard running for steering/approvals: `hermes dashboard --host 127.0.0.1 --port 9119 --no-open` (a systemwide `hermes-gateway.service` does NOT start it by default). Set the dashboard's `basic_auth.username`/`basic_auth.password` (via `hermes config`) to match `HERMES_DASHBOARD_USERNAME`/`HERMES_DASHBOARD_PASSWORD` in `.env`.

### Mode B — Hybrid: Hermes in Docker, HermieOS on the host

You already run the official `hermes-agent` container; HermieOS services run as host processes.

```bash
./scripts/install.sh          # answer 2 (Docker Hermes), host MCP, docker Postgres
```

Resulting key values:

```ini
HERMES_GATEWAY_URL=http://localhost:8642      # compose-internal name does NOT resolve from the host
HERMES_MCP_URL=http://host.docker.internal:3002/mcp   # container reaches the host process
HERMES_DASHBOARD_URL=http://localhost:9119    # published port, not the container name
```

- The MCP server stays a HOST process (mode `host`). Hermes reaches it through Docker's host-gateway alias.
- Registration must run inside the Hermes container: the installer uses `docker exec -i <container> hermes mcp add ...` automatically.
- Skill deployment must happen inside the container too (mount `packages/skills` read-only into it, or run the deployer there); the installer skips host-side deployment for this mode.
- Verify: `docker exec <container> hermes mcp list` shows `hermieos enabled`; restart the container (`/reload-mcp` cannot work from inside the container — it needs the Docker socket).

### Mode C — All Docker (compose)

Two compose profiles:

- **Default** (`docker compose up -d`): postgres + api + mcp + scheduler + fake-hermes + searxng. No real Hermes — the fake records envelopes and returns instantly. Use for tests, CI, and `pnpm demo`.
- **Real** (`docker compose --profile real up -d`): additionally runs the REAL Hermes container wired to the MCP container. Requires `HERMES_USER_EMAIL` set in `.env` and a HermieOS user with that email already in the DB (sign up first at `http://localhost:3001/signup` or via `pnpm demo`). The `hermes-init` one-shot generates the profile + MCP config into the `hermieos_hermes-data` volume before the gateway starts.

Key values inside compose (service-internal, don't put them in `.env`): services talk to `postgres:5432`, `hermes:8642`, `hermieos-mcp:3002`. The compose file handles this via its own defaults; `.env` only overrides knobs it exposes.

Host-facing values (what the BROWSER uses): `HERMES_PUBLIC_URL` (e.g. `http://<LAN-IP>:8642`) and `HERMES_DASHBOARD_PUBLIC_URL=http://localhost:9119`.

### Mode D — Remote Hermes (hybrid remote)

HermieOS runs on your machine; Hermes lives on another box.

```bash
HERMIEOS_GATEWAY_URL=https://hermes.example.com:8642 ./scripts/install.sh
```

- MCP registration must run ON THE REMOTE BOX (`hermes mcp add` there), pointed at a URL reachable from that box — typically your machine's LAN address `http://192.168.x.x:3002/mcp`, never 127.0.0.1.
- `HERMES_MCP_URL` must be the remote-reachable URL; `MCP_PUBLIC_URL` stays local for your own debugging.
- Run `pnpm hermes:skills-deploy` on the remote box.
- Remote dashboard URL + public URL are asked separately (internal vs. browser-facing origin).

### Seeding Hermes data into Docker (existing Hermes user)

If you already run systemwide Hermes and want the Docker Hermes to keep your identity/config:

```bash
docker run --rm -v hermieos_hermes-data:/opt/data \
  -v /home/<you>/.hermes:/seed:ro alpine \
  sh -c "cp -a /seed/. /opt/data/ && chown -R 10000:10000 /opt/data"
```

## Local Setup

Requirements:

- Node.js 22 or newer
- pnpm 10 or newer
- Docker and Docker Compose for the default database setup

Typical setup:

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
```

Notes:

- `.env.example` ships with `DATABASE_URL=...@localhost:15432/hermieos` — that matches the compose Postgres host port. Inside compose services the URL is `postgres://hermieos:hermieos@postgres:5432/hermieos` (set by docker-compose itself). If you use an existing standalone Postgres on 5432, edit the port in your `.env`.
- Services load the repo-root `.env` themselves (`loadRootEnv` in `@hermieos/domain`); you do NOT need `set -a; . ./.env` for `pnpm dev:api` / `dev:mcp` / `dev:scheduler` / `db:migrate` / scripts. Explicit environment variables still win over `.env`.
- `sharp` build scripts are disabled repo-wide (`pnpm-workspace.yaml`) because backend bring-ups don't need it and its postinstall downloads libvips from GitHub (fails on constrained networks). Desktop/Android packagers who need it: `pnpm approve-builds sharp`.

The interactive path is:

```bash
./scripts/install.sh
```

Test the installer without installing packages, changing the database, or wiring Hermes:

```bash
HERMIEOS_DRY_RUN=1 ./scripts/install.sh
```

For automation, set `HERMIEOS_ASSUME_YES=1` plus every required value, including `HERMIEOS_API_KEY` and `HERMIEOS_USER_EMAIL`. Missing required values fail fast instead of waiting for input.

## Agent Setup Flow

Use this order when bringing up a fresh environment:

1. Install dependencies and create `.env` from `.env.example` (or run the installer, which writes it).
2. Start Postgres and apply migrations.
3. Start the API, MCP server, scheduler, and web client.
4. Create or sign in to a HermieOS account and obtain its MCP token from Settings (or let the desktop app fetch it via email/password sign-in).
5. Configure Hermes to reach the HermieOS MCP server (Mode A/B/C/D above).
6. Deploy the HermieOS skills bundle to the Hermes skill directory.
7. Verify the MCP connection, API authentication, chat gateway, and one end-to-end flow.

For the complete local Docker demo, use:

```bash
pnpm db:migrate
pnpm demo
```

For a real Hermes container, use the real profile after setting `HERMES_USER_EMAIL` and the inference credentials in the local `.env`:

```bash
docker compose --profile real up -d
```

The `hermes-init` service writes the Hermes profile and MCP configuration into the named Hermes data volume before the gateway starts. Do not commit that volume or copy its generated credentials into the repository.

## Questions For The User

Ask only for values that cannot be discovered safely from the environment. Never ask the user to paste a live secret into a public issue, README, commit, log, or release note.

### Deployment

- Is HermieOS running on the local machine, in Docker, or on a remote server?
- Is Hermes a local process, a Docker container, or a remote service?
- What API URL should the web client use?
- If testing from a phone, are the phone and API host on the same network, and what LAN address should be used?
- Is HTTPS already configured, or is this explicitly a local HTTP development setup?

### Hermes

- What Hermes profile or account should HermieOS attach to?
- What is the Hermes data directory or container name?
- Should the MCP server run on the host or in Docker?
- If Hermes is remote, what MCP URL is reachable from that remote machine?
- Should dangerous-command approvals remain manual?
- Is the fake Hermes demo sufficient, or should the real Hermes profile be started?

### Credentials

- Which HermieOS account email should be used for profile generation and MCP registration?
- Can the agent read the account MCP token from the configured database, or must the user supply it through `HERMES_MCP_TOKEN`?
- What Hermes API key should be supplied through `HERMIEOS_API_KEY` or the local `.env`?
- Which inference provider/model should Hermes use?

Have the user enter secrets interactively or set them in a local ignored `.env`. Confirm only that a value is present and working; do not repeat the value.

### Database

- Should the installer start the Compose Postgres service or use an existing Postgres instance?
- For an existing instance, what host, port, database, user, and password should be configured?
- Is it safe to run migrations now, and should demo data be seeded?

### Publishing

- Which operating systems and CPU architectures need release artifacts?
- Should Android be a debug APK for testing or a signed production APK?
- What release version and GitHub tag should be used?
- Is GitHub authentication already available through `gh auth login` or the Git credential helper?

## Useful Commands

Run services from the repository root:

```bash
pnpm dev:api
pnpm dev:mcp
pnpm dev:scheduler
pnpm dev:web
```

Run focused web checks:

```bash
pnpm --filter @hermieos/web typecheck
pnpm --filter @hermieos/web test:run
pnpm --filter @hermieos/web build
```

Run API checks:

```bash
pnpm --filter @hermieos/api typecheck
pnpm --filter @hermieos/api test:run
```

Database commands:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:push
pnpm db:studio
```

The full demo uses the fake Hermes service:

```bash
docker compose up -d
pnpm demo
```

## Web Architecture

`packages/web/src/App.tsx` defines routing. Authenticated routes render through `AppShell`, which provides the responsive desktop rail and mobile navigation. The shell and rail use intentionally generic source names even though their visual language is bold editorial design.

- `server.tsx` owns server URL/token state, persistence, connection, and Ping.
- `api.ts` owns API requests and bearer authentication.
- `auth.tsx` owns email/password signup + login; both flows return the account MCP token so the Connect screen can finish connecting in one step.
- `AppShell` provides the shared route frame.
- `MobileNav` provides the mobile header and bottom tabs.
- `ui/sheet.tsx` provides portal-based mobile drawers and sheets.
- `gatewayControl.ts` and `tuiGateway.ts` handle Hermes dashboard WebSocket control.
- `mobile.ts` contains Capacitor-only status bar, keyboard, haptics, and back-button behavior.

When adding a route, check both desktop and mobile layouts. Avoid fixed-width content that can create horizontal overflow. Sheets and drawers must render through the shared sheet primitive so transformed page containers cannot trap fixed overlays.

## Backend Connections

The web client connects to the configured HermieOS API and sends the MCP bearer token in the `Authorization` header. The API runs at `http://localhost:3001` in local desktop development.

For a phone on the same LAN, use the host machine's LAN address, for example:

```text
http://192.168.1.7:3001
```

The API is published on all host interfaces and supports browser/mobile CORS. Hermes' direct chat API has its own `API_SERVER_CORS_ORIGINS` allowlist in `.env`. Production deployments should use HTTPS for the API, Hermes gateway, and dashboard WebSocket.

For an agent connecting to a running API, use the account MCP token as a bearer token:

```bash
curl -i http://localhost:3001/me \
  -H "Authorization: Bearer $MCP_TOKEN"
```

An HTTP `200` confirms authenticated API access. An HTTP `401` without the header confirms that auth protection is active. Never print the token in logs or commit it to a script.

`GET /me/hermes-info` returns `baseUrl`, `token`, and `gatewayConfigured`. When `gatewayConfigured` is `false`, neither `HERMES_PUBLIC_URL` nor `HERMES_GATEWAY_URL` is set on the API — the client shows "Hermes gateway not configured" instead of polling a dead URL. The Hermes API server (`/api/sessions`, port 8642) is part of `hermes gateway run` but only starts with a strong `API_SERVER_KEY` (≥16 chars) in the gateway's env — a messaging-gateway-only install (or a service missing the key) never opens 8642.

## Android

The Capacitor project is under `packages/web/android`. The local debug configuration permits an HTTP LAN backend; the app origin is configured for local HTTP development to avoid Android WebView mixed-content blocking.

Build the debug APK:

```bash
cd packages/web
npx cap sync android
android/gradlew -p android assembleDebug
```

The APK is written to `packages/web/android/app/build/outputs/apk/debug/app-debug.apk`, which is ignored by Git. Test it on an emulator or a phone connected to the same network as the API.

Icon/splash generation uses `@capacitor/assets`, which is an optional dependency (it needs `sharp`, whose build scripts are disabled by default). Enable it only when regenerating icons: `pnpm approve-builds sharp && pnpm --filter @hermieos/web npx capacitor-assets generate --android`.

## Hermes Integration

Hermes must be configured with the HermieOS MCP URL and the account's MCP token. Prefer Hermes' own CLI so it owns its configuration and secret storage:

```bash
pnpm hermes:mcp-register
pnpm hermes:probe
pnpm hermes:skills-deploy
```

The installer derives the MCP URL based on the deployment (see the mode table above).

`hermes mcp add` prompts a FOUR-question sequence when driven non-interactively: requires-auth (`y`), token, enable-all-tools (`y`), save-anyway-on-failure (`n`). `pnpm hermes:mcp-register` pipes all four and then VERIFIES registration by re-running `hermes mcp list` — a CLI run that prints "Connected" but was cancelled at the enable-all prompt is NOT saved, and output string-matching alone would report a false success.

For a system Hermes install, `pnpm hermes:skills-deploy` copies the tracked skill bundle into the configured Hermes skills directory. The deployer is idempotent and warns before overwriting user-edited skills.

For Docker Hermes, do not run the host deployer with `/opt/data` as a host path. Deploy the skills from inside the Hermes container or mount the repository's `packages/skills` directory into the container as a read-only external skill directory.

Troubleshoot in this order:

1. Confirm Postgres and the API are running.
2. Confirm the user email exists and has an MCP token.
3. Confirm `HERMIEOS_MCP_MODE` and `HERMES_MCP_URL` point to the reachable MCP address.
4. Run `pnpm hermes:mcp-register` and confirm `hermes mcp list` actually lists `hermieos` (do not trust the "Connected" line alone).
5. Run `pnpm hermes:probe` and `hermes mcp test hermieos`.
6. Check API, MCP, and Hermes logs without exposing bearer tokens.

## Hermes Dashboard (steer / interrupt / approvals)

`POST /hermes/dashboard-ticket` mints the WebSocket credential the web app needs. It fails in up to three distinct stages and each 503 names its stage:

1. `stage=config` — `HERMES_DASHBOARD_URL` / `HERMES_DASHBOARD_PUBLIC_URL` / `HERMES_DASHBOARD_USERNAME` / `HERMES_DASHBOARD_PASSWORD` incomplete. The installer generates a password; a manual `cp .env.example .env` leaves it blank — set it.
2. `stage=unreachable` — nothing listening on `HERMES_DASHBOARD_URL`. A host install must run `hermes dashboard --host 127.0.0.1 --port 9119 --no-open`; compose `--profile real` provides it via the `hermes` service.
3. `stage=login` / `stage=ticket` — dashboard credentials mismatched (basic_auth in Hermes config MUST equal `HERMES_DASHBOARD_USERNAME`/`HERMES_DASHBOARD_PASSWORD` in `.env`) or the ws-ticket endpoint rejecting the session. The 503 detail now includes the HTTP status and response body snippet.

Note: the cookie→ticket→WS flow requires a Hermes build with the loopback ticket fix for 127.0.0.1-bound dashboards (upstream: `api_auth_ws_ticket` minted a 401 unconditionally in loopback mode because the auth gate never engages there). On unpatched Hermes, bind the dashboard non-loopback with basic_auth configured instead.

The Hermes HTTP API server (port 8642, `/api/sessions` + `/v1/*`) is a *platform* inside `hermes gateway run`, not the messaging gateway itself. It only starts when `API_SERVER_KEY` is set in the gateway's environment and is at least 16 characters (or `platforms.api_server.key` in config.yaml); patched Hermes logs an explicit warning when `API_SERVER_ENABLED` is set but the key is missing/weak. A systemd `hermes-gateway.service` without that key serves chat platforms fine but never opens 8642.

## Verification Checklist

Before a code change is considered complete:

- Run `git diff --check`.
- Run the relevant package typecheck.
- Run the relevant package tests.
- Run a production build for web changes.
- Run an Android Gradle build for Capacitor changes.
- Test server connection, Ping, auth, and back navigation when connection or mobile code changes.
- Confirm `.env`, database files, logs, build directories, APKs, and desktop packages are ignored.
- Scan the staged snapshot for credentials before publishing.

## Public Releases

Keep source code and release binaries separate. Build outputs are ignored locally and uploaded to GitHub Releases:

- Linux AppImage from `packages/web/electron-dist/HermieOS-<version>.AppImage`.
- Linux Debian package from `packages/web/electron-dist/HermieOS-<version>.deb`.
- Android debug or signed release APK from the Android Gradle output directory.

Before publishing, verify that the intended commit contains `LICENSE`, contains no private development notes, and contains no credentials. Never put an API key in release notes, README examples, screenshots, or build configuration.
