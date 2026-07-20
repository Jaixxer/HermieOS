# Generator: builds a Hermes profile's config.yaml + .env from a
# HermieOS user's mcp_token. Run once before the hermes container starts.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/scripts/package.json packages/scripts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --prod=false
COPY packages/scripts packages/scripts
COPY packages/db packages/db
COPY packages/domain packages/domain
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@hermieos/scripts", "hermes-profile-gen"]
