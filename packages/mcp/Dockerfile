# Standalone Dockerfile for the HermieOS MCP server.
#
# Build context: repo root (so pnpm workspace files are available).
# Used by `hermieos-mcp-docker start` to run the MCP server in its
# own container on the same Docker network as the Hermes container,
# which lets Hermes reach it at http://hermieos-mcp:3002/mcp by
# container name without relying on host.docker.internal.
#
# The runtime uses tsx because @hermieos/db and @hermieos/domain are
# shipped as TypeScript source (main: ./src/index.ts) with .js
# extension imports — they don't get a separate compile step. The
# build stage is still here for cases where we want a hardened image.
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
ENV CI=true

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/mcp/package.json packages/mcp/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app .
COPY packages/mcp packages/mcp
COPY packages/db packages/db
COPY packages/domain packages/domain
# Pre-compile the MCP main, but db/domain stay as TS sources.
RUN pnpm -F @hermieos/mcp build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml* ./
COPY --from=build /app/packages packages
COPY --from=build /app/node_modules node_modules
EXPOSE 3002
# Run from source via tsx. Keeps the image simple and matches the
# dev loop (where the MCP also runs from source). The cwd must be the
# package directory so tsx's path resolution can find the .ts files
# that @hermieos/db imports with .js extensions.
WORKDIR /app/packages/mcp
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]
