# Production image for the NestJS API (see features/docker-compose-stack).
#
# Dependency/build stages use the full node:22-bookworm image; the runtime
# uses node:22-bookworm-slim. Both are Debian bookworm (glibc) with the same
# Node 22 ABI, so the native addons built in the deps stages load at runtime.
#
# The full image is required, not just convenient: the top-level
# better-sqlite3 (a direct dependency) always compiles from source with
# node-gyp, so every `npm ci` needs python3/make/g++, which it ships. It also
# ships openssl 3, so Prisma picks the matching (debian-openssl-3.0.x) schema
# engine at install time.
FROM node:22-bookworm AS toolchain
WORKDIR /app

# Build: full install (dev deps included), generate the Prisma client into
# src/generated/prisma, then `nest build`, which compiles it into
# dist/generated/prisma along with the rest of src/.
FROM toolchain AS build
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY nest-cli.json tsconfig.json tsconfig.build.json prisma7.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY src ./src
RUN npx prisma generate && npm run build

# Runtime dependencies. `npm ci --omit=dev` still installs the Prisma CLI:
# `prisma` is an optional peer of @prisma/client, so it's "devOptional" in the
# lockfile and kept in a production install. That's lighter than shipping
# the build stage's full node_modules (nest CLI, vitest, oxlint, ...), and
# the `test` makes the build fail if a future lockfile stops shipping it
# (the entrypoint needs it for `prisma db push`).
FROM toolchain AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && test -x node_modules/.bin/prisma

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Slim has no openssl. Without it Prisma can't detect the libssl version,
# falls back to openssl-1.1.x and tries to download that engine into the
# (read-only) node_modules at startup. With it, detection resolves to 3.0.x
# and the engine installed in prod-deps is used. No build toolchain here.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Absolute path: prisma7.config.ts and src/database/prisma.service.ts pass
# absolute `file:` URLs through unchanged. /data is where compose mounts the
# named volume (no VOLUME here, so a plain `docker run` doesn't create
# anonymous volumes). NODE_ENV is left to the caller: here it only sets the
# session cookie's Secure flag (the app defaults to development).
ENV DATABASE_URL=file:/data/app.db \
  PORT=3000

# App files stay root-owned (read-only for the app user); only /data is
# writable. An empty named volume mounted there inherits the node ownership.
RUN mkdir -p /data && chown node:node /data

# package.json is needed at runtime: "type": "module" makes dist/ and
# prisma7.config.ts load as ESM.
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma7.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY docker-entrypoint.sh ./

USER node
EXPOSE 3000

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
