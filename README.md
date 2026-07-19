# HermieOS

A personal operating system around Hermes Agent. The long-running agent is the brain; HermieOS is the persistence, presentation, and tool surface around it.

- Spec: [`SPEC.md`](./SPEC.md)
- Docs: [`docs/`](./docs/) — start with [decisions.md](./docs/decisions.md) and [roadmap.md](./docs/roadmap.md)

## Status

Phase 0 (foundations). Monorepo, schema, docker-compose, tests, smoke endpoints. No real Hermes wiring yet.

## Prereqs

- Node.js 22+
- pnpm 10+ (`npm i -g pnpm`)
- Docker + Docker Compose (for the Postgres dev DB)

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
pnpm dev:api         # http://127.0.0.1:3001
pnpm dev:mcp         # http://127.0.0.1:3002
pnpm dev:scheduler   # background loop
pnpm dev:web         # web client (skeleton in Phase 0)

# run all tests
pnpm test:run

# typecheck
pnpm typecheck

# lint
pnpm lint
```

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
```

## Repo layout

```
HermieOs/
├── SPEC.md
├── docs/                   # design + roadmap + decisions
├── packages/
│   ├── api/                # user-facing HTTP + SSE
│   ├── mcp/                # MCP server Hermes talks to
│   ├── scheduler/          # dumb cron loop
│   ├── db/                 # Drizzle schema + migrations
│   ├── domain/             # shared zod schemas + types
│   ├── cache/              # in-memory TTL cache
│   └── web/                # React app (PWA-capable)
├── docker-compose.yml      # Postgres only in Phase 0
├── package.json            # workspace root
└── pnpm-workspace.yaml
```

## Phase 0 exit criterion

> `docker compose up` brings up Postgres, runs all migrations cleanly, and the test suite passes. A developer can clone the repo, run two commands, and have a green build.

Verify locally:

```bash
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm test:run
pnpm typecheck
```
