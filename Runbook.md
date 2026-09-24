# RUNBOOK — running twitter-clone

Context for **Alejandro and AI agents**: how to check the environment and launch each
app, from the repo root.

> **Golden rule:** always work from the repo root (where `backend/`, `frontend/`, and
> `.claude/` are siblings). The scripts resolve their own paths, so `scripts/<name>`
> works from any cwd — but the repo root is the home.

This is a plain two-app repo: `backend/` and `frontend/`
are each their own independent npm project with their own `package.json` and
`node_modules`. The scripts under `scripts/` are thin wrappers that `cd` into one of
them and run its own npm scripts — they don't add any build/orchestration logic of
their own.

---

## Quick reference

| I want to… | Command (from repo root) |
|---|---|
| Check the whole environment | `scripts/check-env` |
| Run the **backend** locally (`:3000`) | `scripts/be-local` |
| Run the **frontend** locally (`:5173`) | `scripts/fe-local` |

---

## Scripts index

- **`scripts/check-env`** — checks Node (>=20.11, `frontend/vite.config.js` uses
  `import.meta.dirname`) and npm are installed, that `backend/node_modules` and
  `frontend/node_modules` are present, and that `backend/.env` exists. Read-only.
- **`scripts/be-local`** — `npm run start:dev` in `backend/` (foreground, logs, watch
  mode). Port comes from `PORT` in `backend/.env` if set, otherwise `src/main.ts` falls
  back to **3000**.
- **`scripts/fe-local`** — `npm run dev` in `frontend/` (foreground, Vite dev server,
  default port **5173** — Vite picks the next free port if it's taken).

---

## Backend (`backend/`)

Plain NestJS app (`npm`, not part of a workspace). Reads config via `dotenv/config`
from `backend/.env` (create it from `backend/.env.example`; it's git-ignored).

- **Env vars** (validated at boot by `src/config/environment.validation.ts`, a Zod
  schema — an invalid/missing required var throws on startup rather than failing
  silently later): `PORT` (optional, defaults to 3000), `DATABASE_URL` (required —
  see Database below), `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` (optional —
  [NestJS Observe](https://observe.nestjs.com) APM; the `ObserveModule` only
  registers itself in `src/app.module.ts` when **both** are set to a non-empty
  value, so leaving them blank is a normal, supported way to run without APM).
- **Database**: Prisma (`prisma/schema.prisma`, config in `prisma7.config.ts`),
  driver-adapter based (Prisma 7 requires one — `@prisma/adapter-pg` + `pg`, wired
  in `src/database/prisma.service.ts`). **No Postgres is provisioned yet** —
  `PrismaService` doesn't eagerly `$connect()`, so the app boots fine without a
  reachable database; it'll only fail once a real domain module issues a query.
  `DATABASE_URL` still has to be a syntactically valid Postgres URL (see
  `.env.example`) because Prisma validates it at construction time, but it doesn't
  need to be reachable. Regenerate the client after schema changes:
  `npx prisma generate` (run from `backend/`).
- **Config**: `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true, ... })` in
  `app.module.ts`), loading `src/config/configuration.ts` and validating through
  `src/config/environment.validation.ts`.
- **Cross-cutting**: a single global `AllExceptionsFilter`
  (`src/common/filters/`) normalizes every error response to
  `{ statusCode, message, timestamp, path }`; a global `ValidationPipe`
  (`whitelist: true, transform: true`) and `app.enableCors()` are set in
  `main.ts`.
- **Run**: `start:dev` (watch mode, what `scripts/be-local` uses), `start` (no watch),
  `start:debug`, `start:prod` (runs the compiled `dist/`).
- **Test**: `test` (Vitest unit), `test:watch`, `test:cov` (coverage), `test:debug`,
  `test:e2e` (`vitest.config.e2e.ts`).
- **Build**: `build` (`nest build`), `deploy` (`nest deploy`, via `@nestjs/mau`).
- **Lint/format**: `lint` (`oxlint src/ test/`), `format` (`prettier --write`).

---

## Frontend (`frontend/`)

Plain Vite + React SPA (`npm`, not part of a workspace) — Tailwind CSS v4,
shadcn/ui (Radix base, Nova preset), and `react-router` for client-side routing.

- **Run**: `dev` (Vite dev server, what `scripts/fe-local` uses), `preview` (serves the
  production build).
- **Build**: `build` (`vite build`).
- **Lint**: `lint` (`eslint .`).
- **Structure** (`src/`): `app/` (`App.jsx`, `router.jsx`, `providers.jsx`),
  `components/ui/` (shadcn), `hooks/`, `lib/api/` (HTTP client), `pages/`.
  `features/`, `lib/auth/`, `lib/validation/`, and `routes/` (a `ProtectedRoute`)
  aren't created yet — there's no auth module and no concrete feature to hang them
  on; add them when one exists rather than scaffolding empty folders.
- **API client** (`src/lib/api/client.js`) — reads `VITE_API_URL` from
  `frontend/.env` (defaults to `http://localhost:3000`; Vite only exposes
  `VITE_`-prefixed vars to client code). No auth token is attached yet (no auth
  module) — that's a single, clearly-commented extension point in that file once
  one exists.
- **TanStack Query** — `QueryClientProvider` lives in `src/app/providers.jsx`,
  wrapping `<App>` in `main.jsx`. React Query Devtools are mounted in dev only.
- **Forms** — `react-hook-form`, `zod`, and `@hookform/resolvers` are installed and
  ready, but no form exists yet to wire them into.

---

## Cross-platform

Scripts are `bash`; on Windows run them from **Git Bash** (or WSL). `node` and `npm`
must be on `PATH`.

---
