---
title: Backend architecture
type: infra
summary: Layered NestJS backend (backend/) — current implementation state (Prisma database module, Zod-validated config, global exception filter). No domain modules or auth exist yet.
status: active
last-verified: 2026-09-24
tags: [backend, nestjs, architecture, prisma, config]
---

## Layered architecture

Traditional layered architecture, kept deliberately simple — see [[Code quality]] for
what to avoid (no hexagonal/clean architecture, no CQRS, no ports-and-adapters, no
injection token per repository):

```text
Controller
   ↓
Service
   ↓
Repository
   ↓
Prisma / SQLite
```

Not every module needs every layer — one with no persistence has no repository, one
with no business rules barely needs a service. Add layers because a module needs them,
not by default.

## Current structure (`backend/src/`)

```text
backend/src/
├── main.ts                # bootstrap: CORS, global ValidationPipe, global exception filter
├── app.module.ts          # root module — wires Config, Prisma, (conditionally) Observe
├── app.controller.ts
├── app.service.ts         # placeholder root route, GET / → { message }
├── observe.ts             # NestJS Observe APM module/instrument factory
├── config/
│   ├── configuration.ts           # typed config object (port, database.url)
│   └── environment.validation.ts  # Zod schema, validated at boot via ConfigModule
├── database/
│   ├── prisma.module.ts   # @Global, exports PrismaService
│   └── prisma.service.ts  # extends generated PrismaClient, better-sqlite3 driver adapter
├── common/
│   └── filters/
│       └── all-exceptions.filter.ts  # global, normalizes every error response
│   # decorators/, exceptions/, guards/, interceptors/, pipes/ — not created yet
├── auth/                  # not created yet
├── modules/<domain>/      # not created yet
└── generated/prisma/      # `npx prisma generate` output — gitignored, never hand-edited
```

No `auth/`, no other `common/` subfolder, and no `modules/<domain>/` exist yet: there's
no auth requirement and no domain model defined. Add them, in this same layered shape,
when a real feature needs them — don't scaffold empty folders ahead of time. See
[[Code quality]] for the expected shape of each (the `common/` taxonomy, the auth
module skeleton, the generic domain-module skeleton) so that shape isn't reinvented
per-module or lost between sessions.

## Database

Prisma 7 (`backend/prisma/schema.prisma`, config in `backend/prisma7.config.ts` — loads
`DATABASE_URL` via `dotenv/config`). No models are defined yet.

The database is **SQLite** — a local file, no server. Prisma 7 requires an explicit
**driver adapter** (the bundled query-engine binary is gone), so `PrismaService`
constructs `new PrismaBetterSqlite3({ url })` (`@prisma/adapter-better-sqlite3` +
`better-sqlite3`) and passes it to the `PrismaClient` superclass constructor.

`DATABASE_URL` is a `file:` URL (default `file:./dev.db`). A relative path is anchored
to `backend/prisma/` from the module's own location, not `process.cwd()` — both in
`PrismaService` and in `prisma7.config.ts` — so the CLI and the running app always open
the same file, `backend/prisma/dev.db` (git-ignored). Absolute paths and `:memory:`
pass through unchanged. Create or sync the file with `npx prisma db push`; regenerate
the client after any schema change with `npx prisma generate` (both from `backend/`).
`PrismaService` skips an eager `$connect()`, so the app boots even before the file
exists.

## Config

`@nestjs/config`, loaded globally in `app.module.ts`:
`ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate })`.
`environment.validation.ts` is a Zod schema — `PORT` (optional, default 3000),
`DATABASE_URL` (required), `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` (optional). An
invalid or missing required var throws at boot instead of failing later, deeper in
the app.

`ObserveModule.forRoot(...)` is still wired directly off `process.env` in
`app.module.ts` rather than through `ConfigService` — dynamic module options are
resolved at class-definition time, before Nest's DI container exists, so there's no
clean way to inject `ConfigService` there without moving to `forRootAsync` for no real
benefit. `dotenv/config` (imported first in `main.ts`) already guarantees `.env` is
loaded before `AppModule` evaluates, which is why the raw `process.env` read works.

## Cross-cutting concerns

**Auth.** None yet. No guard, no `@Public()` decorator, no user model — every route is
open by default. Build this once there's an actual auth requirement, not preemptively.

**Error handling.** A single global `AllExceptionsFilter`
(`src/common/filters/all-exceptions.filter.ts`) catches everything and normalizes the
response to `{ statusCode, message, timestamp, path }`. Paired with a global
`ValidationPipe` (`whitelist: true, transform: true`) in `main.ts` — DTOs are expected
to use `class-validator` / `class-transformer` (both installed; no DTO exists yet to
exercise them).

**CORS.** `app.enableCors()` in `main.ts` — required for the Vite frontend (a
different origin/port in dev) to call this API at all.

**Observability.** [NestJS Observe](https://observe.nestjs.com) APM, optional — only
initializes when both `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` are set to a
non-empty value in `backend/.env`; see the Config section above.

## Open questions

- `oxlint.json` currently turns `@typescript-eslint/no-explicit-any` **off**, while
  [[Code quality]] says to avoid `any`. Not reconciled — flagging so it isn't
  silently re-decided; revisit if `any` actually starts showing up in reviews.
- No domain module exists yet, so the "Repository" layer above isn't built yet. It is
  the rule, though: repositories are the only layer injecting `PrismaService` (plain
  `@Injectable()` classes — no interface, no injection token), enforced by
  `.claude/review-contract.md` §B.
