# Generator: builds a Hermes profile's config.yaml + .env from a
# HermieOS user's mcp_token. Run once before the hermes container starts.
FROM node:22-alpine
WORKDIR /app
# Corepack needs a writable cache for the package-manager shim. When
# we drop to UID 10000 (matching the Hermes image) the default
# locations are no longer writable, so put HOME, XDG_CACHE_HOME, and
# the corepack cache under /tmp where every user can write.
ENV HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    COREPACK_CACHE_FOLDER=/tmp/.cache/node/corepack
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
# Hermes (the Nous Research image) runs as UID 10000 and reads the
# /opt/hermes volume. Match that here so the files this container
# writes are owned by the right user. Adjust with HERMES_UID/GID
# build args if your setup differs.
ARG HERMES_UID=10000
ARG HERMES_GID=10000
USER ${HERMES_UID}:${HERMES_GID}
# Run from /opt/data so the generator can read the existing
# config.yaml at its expected location. The hermes image stores user
# data at $HERMES_HOME which is set to /opt/data by the compose
# service, matching this CWD.
WORKDIR /opt/data
CMD ["pnpm", "--filter", "@hermieos/scripts", "hermes-profile-gen"]
