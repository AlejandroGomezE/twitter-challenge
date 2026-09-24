---
title: Backend architecture
type: infra
summary: Layered NestJS backend (backend/) — current implementation state (Prisma database module, Zod-validated config, global exception filter, email+password auth with cookie sessions, users module with profiles).
status: active
last-verified: 2026-09-24
tags: [backend, nestjs, architecture, prisma, config, auth]
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
├── main.ts                # bootstrap: NestFactory.create → configureApp(app) → listen
├── app.setup.ts           # configureApp(app): helmet, cookie-parser, CORS, ValidationPipe,
│                          #   ResponseSerializerInterceptor, exception filter — shared by
│                          #   main.ts and the e2e suite
├── app.module.ts          # root module — wires Config, Prisma, Auth, Users, (conditionally) Observe
├── observe.ts             # NestJS Observe APM module/instrument factory
├── config/
│   ├── configuration.ts           # typed config (nodeEnv, port, database.url, frontendOrigin)
│   └── environment.validation.ts  # Zod schema, validated at boot via ConfigModule
├── database/
│   ├── prisma.module.ts   # @Global, exports PrismaService
│   └── prisma.service.ts  # extends generated PrismaClient, better-sqlite3 driver adapter
├── common/
│   ├── filters/
│   │   └── all-exceptions.filter.ts  # global, normalizes every error response
│   └── interceptors/
│       └── response-serializer.interceptor.ts  # global fail-closed response whitelist
│   # decorators/, exceptions/, guards/, pipes/ — not created yet
├── auth/
│   ├── auth.module.ts             # imports UsersModule + ThrottlerModule; APP_GUARD = AuthGuard
│   ├── auth.controller.ts         # POST /auth/sign-up, /sign-in, /sign-out; GET /auth/me
│   ├── auth.service.ts            # credential check, session create/validate/revoke
│   ├── auth.guard.ts              # global guard: Origin check → @Public() → session
│   ├── sessions.repository.ts     # Prisma access for Session (token hashes only)
│   ├── public.decorator.ts        # @Public() — opts a handler/controller out of the session check
│   ├── current-user.decorator.ts  # @CurrentUser() — the user AuthGuard put on the request
│   ├── authenticated-user.interface.ts
│   ├── session-cookie.ts          # set / clear / read the `sid` cookie
│   ├── session.constants.ts       # cookie name, 7-day TTL
│   └── dto/                       # request DTOs: SignUpDto, SignInDto (class-validator)
├── modules/
│   └── users/
│       ├── dto/
│       │   ├── user-response.dto.ts        # UserResponseDto { id, email, username }
│       │   ├── profile-response.dto.ts     # ProfileResponseDto { username, bio, createdAt }
│       │   ├── my-profile-response.dto.ts  # MyProfileResponseDto { id, email, username, bio,
│       │   │                               #   createdAt } — the caller's own profile
│       │   └── update-profile.dto.ts       # UpdateProfileDto { username?, bio? }
│       ├── username.rules.ts      # authoritative username/bio rules: RESERVED_USERNAMES,
│       │                          #   normalizers, @IsUsername() / @IsBio() DTO decorators
│       ├── users.module.ts        # UsersController; exports UsersService
│       ├── users.controller.ts    # GET /users/:username, PATCH /users/me
│       ├── users.service.ts       # create (argon2id hash, 409 on duplicate), lookups,
│       │                          #   getProfile, updateProfile
│       └── users.repository.ts    # Prisma access for User
└── generated/prisma/      # `npx prisma generate` output — gitignored, never hand-edited
```

No other `common/` subfolder exists yet, and `modules/users/` is the only domain module
(users are created through the auth flow; `UsersController` serves profiles). Add more, in
this same layered shape, when a real feature needs them — don't scaffold empty folders
ahead of time. See [[Code quality]] for the expected shape of each (the `common/`
taxonomy, the generic domain-module skeleton). The auth guard and decorators live in
`auth/`, next to the module that owns them, not in `common/`.

## Database

Prisma 7 (`backend/prisma/schema.prisma`, config in `backend/prisma7.config.ts` — loads
`DATABASE_URL` via `dotenv/config`). Models: `User` (`id` cuid, `email` unique,
`username` unique and required, `bio` optional, `passwordHash`, timestamps) and `Session`
(`id`, `tokenHash` unique, `userId` → `User` with `onDelete: Cascade`, `expiresAt`,
`createdAt`; indexed on `userId`). Usernames are stored lowercase by the app, so the plain
unique index gives case-insensitive uniqueness on SQLite without a custom collation. After
pulling a schema change, run `npx prisma db push` (and `npx prisma generate`) from
`backend/`. The profile change added a required column, so it needs
`npx prisma db push --force-reset`, which wipes the dev DB (no backfill — there's no
production data).

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
`environment.validation.ts` is a Zod schema — `NODE_ENV` (`development` | `production`
| `test`, default `development`), `PORT` (optional, default 3000), `DATABASE_URL`
(required), `FRONTEND_ORIGIN` (default `http://localhost:5173`; must be an exact origin
— no path or trailing slash — because CORS and the guard compare it verbatim with the
`Origin` header), `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` (optional). An invalid or
missing required var throws at boot instead of failing later, deeper in the app.

`ObserveModule.forRoot(...)` is still wired directly off `process.env` in
`app.module.ts` rather than through `ConfigService` — dynamic module options are
resolved at class-definition time, before Nest's DI container exists, so there's no
clean way to inject `ConfigService` there without moving to `forRootAsync` for no real
benefit. `dotenv/config` (imported first in `main.ts`) already guarantees `.env` is
loaded before `AppModule` evaluates, which is why the raw `process.env` read works.

## Cross-cutting concerns

All HTTP-level setup lives in `configureApp(app)` (`src/app.setup.ts`), called by
`main.ts` and by `test/app.e2e-spec.ts`, so e2e tests exercise the same pipeline as the
running server.

**Auth.** Email + password with server-side sessions (`src/auth/`, `src/modules/users/`).

- **Endpoints.** `POST /auth/sign-up` `{ email, username, password }` (201 + cookie,
  `{ id, email, username }`; 409 `Email is already registered` / `Username is already
  taken`), `POST /auth/sign-in` (200 + cookie, `{ id, email, username }`), `POST
  /auth/sign-out` (204; public and idempotent — revokes the session if any, always clears
  the cookie), `GET /auth/me` (`{ id, email, username }` or 401).
- **Global guard.** `AuthGuard` is registered as `APP_GUARD` in `AuthModule`, so every
  route requires a session by default. Order in `canActivate`: (1) **Origin check** —
  `POST/PUT/PATCH/DELETE` with an `Origin` other than `FRONTEND_ORIGIN` → 403, on
  `@Public()` routes too (login CSRF); a missing `Origin` is allowed, since non-browser
  clients carry no ambient cookie; (2) **`@Public()`** → allowed; (3) **session** — the
  `sid` cookie must resolve to a live session, else 401. The resolved user is set on
  `request.user` and read with `@CurrentUser()`.
- **Sessions.** Opaque token of 32 random bytes (`crypto.randomBytes`, base64url); only
  its SHA-256 hash is stored (`Session.tokenHash`). 7-day **absolute** expiry (not
  sliding), enforced server-side — an expired row is rejected and deleted, and expired
  rows are swept whenever a new session is created. A fresh session on every
  sign-up/sign-in; sign-out deletes it. Cookie `sid`: `HttpOnly`, `SameSite=Lax`,
  `Path=/`, `Expires` = session expiry, `Secure` when `NODE_ENV=production`.
  `cookie-parser` runs without a secret — the token is checked against the stored hash,
  so signing adds nothing.
- **Passwords.** argon2id (`argon2` package): `memoryCost: 19456` (19 MiB),
  `timeCost: 2`, `parallelism: 1` (`ARGON2_OPTIONS` in `users.service.ts`); the salt is
  per-hash and encoded in the hash string. DTO policy: password 12–128 chars on sign-up,
  1–128 on sign-in; email trimmed + lowercased, `@IsEmail`, max 254, unique (the unique
  index's P2002 → 409, no find-then-create race).
- **No enumeration on sign-in.** Unknown email and wrong password both return the same
  `401 Invalid email or password`; an unknown email still runs `argon2.verify` against a
  dummy hash precomputed at startup (`onModuleInit`) so timing matches. (Sign-up's 409 does reveal a registered
  email — accepted trade-off, mitigated by the rate limit.)
- **Throttling.** `@nestjs/throttler`, configured in `AuthModule` (throttler `auth`: 5
  requests / 60 s per client IP, per route). `ThrottlerGuard` is applied per handler
  (`@UseGuards`) on sign-up and sign-in only — not globally → 429 beyond the limit.

**Profiles** (`src/modules/users/`, `UsersController`; both routes session-gated, no
`@Public()`).

- **Endpoints.** `GET /users/:username` → `ProfileResponseDto { username, bio, createdAt }`
  (case-insensitive lookup; never email or id) or 404 `User not found`. `PATCH /users/me`
  `{ username?, bio? }` → `MyProfileResponseDto { id, email, username, bio, createdAt }`;
  409 `Username is already taken`. The target id comes only from `@CurrentUser()`; unknown
  fields are stripped by the `ValidationPipe` whitelist; an empty body is a no-op.
- **Rules** (`username.rules.ts`, authoritative; the frontend mirror
  `frontend/src/lib/validation/profile-schemas.js` must match, `RESERVED_USERNAMES`
  included — the two are duplicated because the repo-root `shared/` folder is wired into
  neither build). Username: trimmed + lowercased, 3–20 chars of `[a-z0-9_]`, not reserved
  (`me`, `settings`, `sign-in`, `sign-up`, `sign-out`, `auth`, `users`, `u`, `api`,
  `admin`, `root`). Bio: optional, trimmed, max 160; an empty string (or `null`) clears it.
- **Validation decorators.** `@IsUsername()` / `@IsBio()` bundle, via `applyDecorators`, a
  normalizing `@Transform` plus the `class-validator` checks. The transform runs in
  `plainToInstance`, before validation, so rules are checked against the value that will be
  stored. Reused by `SignUpDto` and `UpdateProfileDto` (add `@IsOptional()` next to
  `@IsUsername()` when the field may be omitted; `@IsBio()` is always optional).
- **Which unique field collided.** Sign-up can hit either unique index, so
  `UsersService` reads the P2002's fields to pick the 409 message. With Prisma 7 + the
  better-sqlite3 adapter there is **no `meta.target`** — the fields are under
  `meta.driverAdapterError.cause.constraint.fields`; `meta.target` is still read for
  non-adapter engines, and if neither is present it falls back to checking whether the
  email exists. `updateProfile` can only write `username`, so any P2002 there is a taken
  username (and P2025 → 404).

**Error handling.** A single global `AllExceptionsFilter`
(`src/common/filters/all-exceptions.filter.ts`) catches everything and normalizes the
response to `{ statusCode, message, timestamp, path }`. Paired with a global
`ValidationPipe` (`whitelist: true, transform: true`, implicit conversion) — DTOs use
`class-validator` / `class-transformer` (see `src/auth/dto/`, `src/modules/users/dto/`).

**Responses.** Request DTOs validate input (`class-validator`); response DTOs define
output. Every handler that returns a body returns a response DTO — a class with
`@Expose()` on each emitted field and nothing else exposed (e.g.
`UserResponseDto`) — declared with `@SerializeOptions({ type: XResponseDto })` plus
the matching concrete return type. The global `ResponseSerializerInterceptor`
(`src/common/interceptors/`, a `ClassSerializerInterceptor` subclass with
`excludeExtraneousValues: true`, registered in `configureApp`) converts the returned
value to that class and emits only exposed fields, so even a full Prisma row with
`passwordHash` can't leak. It fails closed: a body without a declared `type` (even a
DTO instance) is a 500, never passed through unfiltered. Never return Prisma models/entities or
internal service types (`PublicUser`, `PublicProfile`, `MyProfile`, `AuthenticatedUser`)
directly. 204 endpoints
(`POST /auth/sign-out`) return `void` and need no DTO.

**CORS.** `app.enableCors({ origin: [FRONTEND_ORIGIN], credentials: true })` — an
exact-match allowlist of one origin (never `*`); any other origin gets no
`Access-Control-Allow-Origin`. Required for the Vite frontend (`:5173`) to call the API
(`:3000`) with the session cookie.

**Security headers.** `helmet()` defaults.

**Observability.** [NestJS Observe](https://observe.nestjs.com) APM, optional — only
initializes when both `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` are set to a
non-empty value in `backend/.env`; see the Config section above.

## Open questions

- `oxlint.json` currently turns `@typescript-eslint/no-explicit-any` **off**, while
  [[Code quality]] says to avoid `any`. Not reconciled — flagging so it isn't
  silently re-decided; revisit if `any` actually starts showing up in reviews.
- Repository layer: built — `UsersRepository` (`modules/users/`) and
  `SessionsRepository` (`auth/`). Repositories are the only layer injecting
  `PrismaService` (plain `@Injectable()` classes — no interface, no injection token),
  enforced by `.claude/review-contract.md` §B.
- Throttling keys on the client IP as Express sees it; there's no `trust proxy` setting,
  so behind a reverse proxy every client would share one bucket. Revisit when deployed.
