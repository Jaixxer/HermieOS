# HermieOS

A personal operating system around Hermes Agent. The long-running agent is the brain; HermieOS is the persistence, presentation, and tool surface around it.

- Spec: [`SPEC.md`](./SPEC.md)
- Docs: [`docs/`](./docs/) — start with [decisions.md](./docs/decisions.md) and [roadmap.md](./docs/roadmap.md)

## Status

MVP feature-complete (Phases 0–4 done; Phase 5 hardening in progress). Hermes is wired up via a "fake Hermes" stand-in. The full loop runs locally with `pnpm demo`.

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

## Web client

`packages/web` is a Vite + React 19 + TanStack Query + Tailwind v4 app.

```bash
pnpm --filter @hermieos/web dev   # http://127.0.0.1:5173
pnpm --filter @hermieos/web build
pnpm --filter @hermieos/web e2e   # Playwright
```

The web client expects the API on `:3001`. In dev, the Vite dev server proxies `/api/*` to `http://localhost:3001`.

## Repo layout

```
HermieOs/
├── SPEC.md
├── docs/                   # design + roadmap + decisions
├── scripts/                # demo, seed
├── packages/
│   ├── api/                # user-facing HTTP + SSE
│   ├── mcp/                # MCP server Hermes talks to
│   ├── scheduler/          # dumb cron loop
│   ├── db/                 # Drizzle schema + migrations
│   ├── domain/             # shared zod schemas + types
│   ├── cache/              # in-memory TTL cache
│   └── web/                # React app (PWA-capable)
├── docker-compose.yml      # Postgres + api + mcp + scheduler + fake-hermes
├── Dockerfile              # shared image for api/mcp/scheduler
├── package.json            # workspace root
└── pnpm-workspace.yaml
```

## How to use this repo

- **`docs/roadmap.md`** is the high-level plan. Each phase has an exit criterion.
- **`docs/decisions.md`** records the locked design choices.
- **`docs/data-model.md`** is the schema spec.
- **`docs/hermes-integration.md`** is the wiring for a real Hermes install.
- **`SPEC.md`** is the full product spec.

## MVP exit criterion

> A developer can clone, run `docker compose up -d && pnpm db:migrate && pnpm demo`, and see the full loop in under 10 minutes. The pause flag stops the scheduler. The feed updates live. Errors are structured. CI green. No known P0 bugs.

Verify locally:

```bash
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm test:run
pnpm typecheck
pnpm demo
```
