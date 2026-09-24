---
slug: migrate-to-sqlite
status: verifying
scope: backend
next: /close-feature migrate-to-sqlite
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
- [x] Update `backend/prisma/schema.prisma` datasource to `provider = "sqlite"`.
- [x] Swap Prisma dependencies in `backend/package.json`: remove `pg` + `@prisma/adapter-pg` (+
  `@types/pg`), add the SQLite driver adapter package(s); `npm install`.
- [x] Rewire `backend/src/database/prisma.service.ts` to use the new SQLite adapter.
- [x] Update `DATABASE_URL` in `backend/.env` and `backend/.env.example` to a `file:` SQLite
  path, with a comment matching the new reality (no more "syntactically valid Postgres URL").
- [x] Add the local `.db`/`.db-journal` file(s) to `backend/.gitignore`.
- [x] Run `npx prisma generate` and `npx prisma db push` (or equivalent) from `backend/` to
  create the actual SQLite database file, and confirm the backend boots.
- [x] Update the Postgres-specific mentions in `runbook.md` (Database section) and
  `.claude/ROADMAP.md` ("No database provisioned" bullet) to reflect SQLite.

## Decisions
- 2026-09-24 · framed · No models exist yet in `schema.prisma`, so this is a driver/config swap,
  not a data migration — there's no existing data or migration history to carry over.
- 2026-09-24 · framed · Picked `@prisma/adapter-better-sqlite3` as the default SQLite driver
  adapter (matches the existing driver-adapter pattern used for `@prisma/adapter-pg`); confirm
  exact package/version compatibility with `prisma@7.10.0` during `/implement`.
- 2026-09-24 · building · A first-round implementation used a bare `DATABASE_URL=file:./dev.db`.
  Review caught a real bug: the Prisma CLI and the `@prisma/adapter-better-sqlite3` runtime
  adapter both resolve relative `file:` paths against `process.cwd()`, which differs between CLI
  invocation and app runtime invocation — so they silently opened two different SQLite files.
  Fixed by anchoring the relative path explicitly in code (module-location-based, not
  cwd-based) in both `prisma.service.ts` and `prisma7.config.ts`, verified empirically (CLI
  `db push` and a runtime probe from a different cwd both converge on the same
  `backend/prisma/dev.db`). A stray, unrelated edit to `knowledge/infra/code-quality.md`
  (implementer debris) was found during orchestrator verification and reverted.

## Follow-ups
- `test:e2e` was already failing on `main` (spec expected plain `'Hello World!'`, controller returns
  `{ message: 'Hello World!' }`) — unrelated to this feature; Alejandro is committing the spec fix
  separately.
- Dev servers from `scripts/be-local`/`fe-local` were piling up as orphans (7 `nest --watch`
  processes + a stale `dist/main` on :3000, 2 Vite servers). Addressed outside this feature by the
  new `scripts/down-be`/`scripts/down-fe` + `CONVENTIONS.md` §10, committed separately.

## Log
- 2026-09-24 · framed
- 2026-09-24 · built — datasource swapped to SQLite (`@prisma/adapter-better-sqlite3`), a real
  path-resolution bug caught by review and fixed, docs updated, backend builds/tests/boots
  clean against a real local `backend/prisma/dev.db`.
- 2026-09-24 · verified — all 4 acceptance criteria exercised against the running app (boot on
  SQLite, real query via `PrismaService` from a foreign cwd lands on `backend/prisma/dev.db`,
  `dev.db` git-ignored); stale Postgres comment in `schema.prisma` removed.
