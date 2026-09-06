# HermieOS

A personal operating system around Hermes Agent. The long-running agent is the brain; HermieOS is the persistence, presentation, and tool surface around it.

## Status

HermieOS is a responsive web client with Electron desktop packaging and a native Android shell. It connects to an existing Hermes Agent instance and keeps persistence, presentation, MCP tools, scheduling, chat, scouting, missions, findings, and knowledge in one workspace.

## Releases

See the [v0.0.1 release](https://github.com/Jaixxer/HermieOS/releases/tag/v0.0.1):

- [Android APK](https://github.com/Jaixxer/HermieOS/releases/download/v0.0.1/app-debug.apk) — debug build for local testing
- [Linux AppImage](https://github.com/Jaixxer/HermieOS/releases/download/v0.0.1/HermieOS-0.0.1.AppImage)
- [Linux Debian package](https://github.com/Jaixxer/HermieOS/releases/download/v0.0.1/HermieOS-0.0.1.deb)

The Android debug build is intended for testing. Production deployments should use HTTPS for the API and Hermes gateway.

## Prereqs

- Node.js 22+
- pnpm 10+ (`npm i -g pnpm`)
- Docker + Docker Compose (for the Postgres dev DB) — or a local Postgres 17

## First-time setup

```bash
# 1. install deps
pnpm install

# 2. copy env
cp .env.example .env

# 3. bring up Postgres
docker compose up -d postgres

# 4. run migrations (creates the schema)
pnpm db:migrate
```

## Installer

The interactive installer creates `.env`, checks prerequisites, starts the selected database, applies migrations, and optionally wires Hermes to the HermieOS MCP server:

```bash
git clone https://github.com/Jaixxer/HermieOS.git
cd HermieOS
./scripts/install.sh
```

Use `HERMIEOS_DRY_RUN=1 ./scripts/install.sh` to configure without installing or migrating. The installer never stores credentials in Git; `.env` is ignored.

## Dev loop

```bash
# run a service
pnpm dev:api         # http://127.0.0.1:3001  (REST + SSE)
pnpm dev:mcp         # http://127.0.0.1:3002  (MCP server Hermes talks to)
pnpm dev:scheduler   # background loop
pnpm dev:web         # web client at http://127.0.0.1:5173

# run all tests
pnpm test:run

# typecheck
pnpm typecheck

# lint
pnpm lint

# end-to-end scripts (one per service)
pnpm mcp:e2e
pnpm scheduler:e2e
pnpm api:e2e
```

## The full demo

```bash
# bring up Postgres + the three services (api, mcp, scheduler) and a fake Hermes
docker compose up -d

# run the full loop locally: sign up, create a project, dispatch a
# subscription, watch the scheduler fire it, see the feed update.
pnpm demo
```

`pnpm demo` runs `scripts/demo.ts` and completes in under 10 minutes.

## DB

```bash
# generate a new migration after a schema change
pnpm db:generate

# apply migrations
pnpm db:migrate

# push schema directly (dev only — bypasses migrations)
pnpm db:push

# open Drizzle Studio
pnpm db:studio

# seed a small dataset for manual testing
pnpm db:seed
```

## Web client + desktop app

`packages/web` is a Vite + React 19 + TanStack Query + Tailwind v4 app, wrapped in an
Electron shell for the desktop experience.

```bash
pnpm --filter @hermieos/web dev   # http://127.0.0.1:5173
pnpm --filter @hermieos/web build
pnpm --filter @hermieos/web e2e   # Playwright

# desktop AppImage (after pnpm build)
cd packages/web && npx electron-builder --linux AppImage
```

The web client expects the API on `:3001`. In dev, the Vite dev server proxies `/api/*` to `http://localhost:3001`.

## Mobile app

Install the Android APK from the release page, then set the HermieOS server URL in Connect or Settings. For a server on the same Wi-Fi network, use its LAN address, for example `http://192.168.1.7:3001`, and provide the account MCP token. The phone and server must be on the same network.

## Repo layout

```
HermieOs/
├── LICENSE                 # MIT license
├── scripts/install.sh      # interactive installer
├── packages/
│   ├── api/                # user-facing HTTP + SSE (Fastify, :3001)
│   ├── mcp/                # MCP server Hermes talks to (:3002) + THE DATA LAYER
│   ├── scheduler/          # dumb cron loop (subscriptions, feedback review)
│   ├── db/                 # Drizzle schema + migrations
│   ├── domain/             # shared zod schemas + constants
│   ├── cache/              # in-memory TTL cache
│   ├── scripts/            # demo, e2e phase scripts, hermes tooling
│   ├── skills/             # hermes skill definitions
│   └── web/                # React app (PWA-capable) + Electron shell
├── docker-compose.yml      # Postgres + api + mcp + scheduler + fake-hermes (+ real hermes opt-in)
├── Dockerfile              # shared image for api/mcp/scheduler
├── package.json            # workspace root
└── pnpm-workspace.yaml
```

## License

HermieOS is released under the [MIT License](./LICENSE).
