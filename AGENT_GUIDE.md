# HermieOS Agent Guide

This guide is for agents and maintainers working in the public HermieOS repository. It covers both end-to-end setup and safe code changes. Read the repository files and existing implementation before changing behavior. Keep changes small, testable, and compatible with the current desktop and mobile surfaces.

## Project Shape

HermieOS is a persistence and presentation layer around an existing Hermes Agent. It does not bundle its own agent.

- `packages/api` is the Fastify REST and SSE API on port `3001`.
- `packages/mcp` is the MCP server Hermes uses on port `3002`.
- `packages/scheduler` dispatches background work to Hermes.
- `packages/db` contains Drizzle schema and migrations.
- `packages/domain` contains shared schemas and constants.
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

1. Install dependencies and create `.env` from `.env.example`.
2. Start Postgres and apply migrations.
3. Start the API, MCP server, scheduler, and web client.
4. Create or sign in to a HermieOS account and obtain its MCP token from Settings.
5. Configure Hermes to reach the HermieOS MCP server.
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

## Android

The Capacitor project is under `packages/web/android`. The local debug configuration permits an HTTP LAN backend; the app origin is configured for local HTTP development to avoid Android WebView mixed-content blocking.

Build the debug APK:

```bash
cd packages/web
npx cap sync android
android/gradlew -p android assembleDebug
```

The APK is written to `packages/web/android/app/build/outputs/apk/debug/app-debug.apk`, which is ignored by Git. Test it on an emulator or a phone connected to the same network as the API.

## Hermes Integration

Hermes must be configured with the HermieOS MCP URL and the account's MCP token. Prefer Hermes' own CLI so it owns its configuration and secret storage:

```bash
pnpm hermes:mcp-register
pnpm hermes:probe
pnpm hermes:skills-deploy
```

The installer derives the MCP URL based on the deployment:

- Local Hermes: `http://127.0.0.1:3002/mcp`
- Hermes in Docker with host MCP: `http://host.docker.internal:3002/mcp`
- Hermes and MCP in Docker: `http://hermieos-mcp:3002/mcp`
- Remote Hermes: use the MCP URL reachable from the remote machine

For a system Hermes install, `pnpm hermes:skills-deploy` copies the tracked skill bundle into the configured Hermes skills directory. The deployer is idempotent and warns before overwriting user-edited skills.

For Docker Hermes, do not run the host deployer with `/opt/data` as a host path. Deploy the skills from inside the Hermes container or mount the repository's `packages/skills` directory into the container as a read-only external skill directory.

Troubleshoot in this order:

1. Confirm Postgres and the API are running.
2. Confirm the user email exists and has an MCP token.
3. Confirm `HERMIEOS_MCP_MODE` and `HERMES_MCP_URL` point to the reachable MCP address.
4. Run `pnpm hermes:mcp-register` and inspect its connection result.
5. Run `pnpm hermes:probe` and `hermes mcp test hermieos`.
6. Check API, MCP, and Hermes logs without exposing bearer tokens.

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
