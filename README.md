# HermieOS

A personal operating system around Hermes Agent. The long-running agent is the brain; HermieOS is the persistence, presentation, and tool surface around it.

## Status

Feature-complete through Phase 10.6 + Phase 11: dashboard redesign (Mission / Opportunities / Knowledge pages), notifications pipeline with native OS notifications in the desktop app, knowledge graph + settings improvements, two-way Google Calendar sync — plus finding conversations: a dedicated discuss page per finding, immediate follow-ups (chat or tracked background runs) that record raw feedback, a snap-scrolling findings deck, and scout self-tuning via MCP (Hermes can retune its own scouts; every run is visible in the Feed). All wired to a real Hermes instance (or the "fake Hermes" stand-in for the demo loop).

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

## Repo layout

```
HermieOs/
├── SPEC.md
├── docs/                   # design + roadmap + decisions + codebase guide
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

## How to use this repo

- **`docs/guide.md`** — the codebase map: layers, where things live, key flows, testing, gotchas. Read this first (humans and agents alike).
- **`docs/roadmap.md`** — the high-level plan. Each phase has an exit criterion.
- **`docs/decisions.md`** — records the locked design choices.
- **`docs/data-model.md`** — the schema spec (all 18 tables).
- **`docs/mcp-tools.md`** — the full tool surface Hermes can call.
- **`docs/hermes-integration.md`** — the wiring for a real Hermes install.
- **`docs/follow-ups.md`** — finding conversations, immediate follow-ups, the findings deck, scout self-tuning.
- **`SPEC.md`** — the full product spec.

## Status table

See `docs/roadmap.md` → "Tracking" for the phase status table. Current state: Phases 0–10.6 + 11 (finding conversations, immediate follow-ups, findings deck, scout self-tuning) are done.
