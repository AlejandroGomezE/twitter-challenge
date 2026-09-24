---
slug: migrate-to-sqlite
status: framed
scope: backend
next: /implement migrate-to-sqlite
---
# Migrate from PostgreSQL to SQLite

## Plan
- Touched surface: `backend/prisma/schema.prisma`, `backend/package.json` (drop `pg` +
  `@prisma/adapter-pg`, add the SQLite driver adapter — e.g. `@prisma/adapter-better-sqlite3` +
  `better-sqlite3`), `backend/src/database/prisma.service.ts`, `backend/.env` +
  `backend/.env.example`, `backend/.gitignore` (ignore the local `.db` file), plus the doc
  references in `runbook.md` and `.claude/ROADMAP.md` that currently describe the database as
  Postgres.
- Acceptance criteria:
  1. `schema.prisma`'s datasource provider is `sqlite`, and `DATABASE_URL` is a valid
     `file:...` path (no more Postgres connection string).
  2. `PrismaService` is wired to the SQLite driver adapter instead of `PrismaPg`; `npx prisma
     generate` succeeds from `backend/`.
  3. A real SQLite database file exists under `backend/` (created via `npx prisma db push` or
     equivalent) and is git-ignored, not committed.
  4. Backend boots (`scripts/be-local` / `npm run start:dev`) with no Postgres involved anywhere.
- Must not break: existing backend boot/env-validation behavior (`environment.validation.ts`
  already just requires `DATABASE_URL` to be a non-empty string, so no schema change needed
  there) and the `test:e2e` / `test` scripts.

## Tasks
- [ ] Update `backend/prisma/schema.prisma` datasource to `provider = "sqlite"`.
- [ ] Swap Prisma dependencies in `backend/package.json`: remove `pg` + `@prisma/adapter-pg` (+
  `@types/pg`), add the SQLite driver adapter package(s); `npm install`.
- [ ] Rewire `backend/src/database/prisma.service.ts` to use the new SQLite adapter.
- [ ] Update `DATABASE_URL` in `backend/.env` and `backend/.env.example` to a `file:` SQLite
  path, with a comment matching the new reality (no more "syntactically valid Postgres URL").
- [ ] Add the local `.db`/`.db-journal` file(s) to `backend/.gitignore`.
- [ ] Run `npx prisma generate` and `npx prisma db push` (or equivalent) from `backend/` to
  create the actual SQLite database file, and confirm the backend boots.
- [ ] Update the Postgres-specific mentions in `runbook.md` (Database section) and
  `.claude/ROADMAP.md` ("No database provisioned" bullet) to reflect SQLite.

## Decisions
- 2026-09-24 · framed · No models exist yet in `schema.prisma`, so this is a driver/config swap,
  not a data migration — there's no existing data or migration history to carry over.
- 2026-09-24 · framed · Picked `@prisma/adapter-better-sqlite3` as the default SQLite driver
  adapter (matches the existing driver-adapter pattern used for `@prisma/adapter-pg`); confirm
  exact package/version compatibility with `prisma@7.10.0` during `/implement`.

## Follow-ups

## Log
- 2026-09-24 · framed
