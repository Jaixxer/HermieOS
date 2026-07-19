# Multi-stage build for the HermieOS services.
# All three services (api, mcp, scheduler) share the same Dockerfile;
# the entrypoint picks which one to run based on $SERVICE.
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
ENV CI=true

# Install dependencies with caching
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/mcp/package.json packages/mcp/
COPY packages/scheduler/package.json packages/scheduler/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/cache/package.json packages/cache/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app /app
COPY . .
RUN pnpm -r --filter=@hermieos/api --filter=@hermieos/mcp --filter=@hermieos/scheduler build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml* ./
COPY --from=build /app/packages packages
COPY --from=build /app/node_modules node_modules
EXPOSE 3001 3002
CMD ["sh", "-c", "node packages/${SERVICE}/dist/main.js"]
