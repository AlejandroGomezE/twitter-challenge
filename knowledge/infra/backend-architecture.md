---
title: Backend architecture
type: infra
summary: Layered NestJS backend (backend/) — current implementation state (Prisma database module, Zod-validated config, global exception filter, email+password auth with cookie sessions, users module with profiles, posts module with feed, likes and comments; keyset pagination, named throttlers).
status: active
last-verified: 2026-09-24
tags: [backend, nestjs, architecture, prisma, config, auth, posts, pagination, throttling]
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
├── app.module.ts          # root module — wires Config, Prisma, Auth, Users, Posts, (conditionally)
│                          #   Observe
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
│   ├── auth.module.ts             # imports UsersModule + ThrottlerModule (global, THROTTLERS);
│   │                              #   APP_GUARD = AuthGuard
│   ├── throttlers.ts              # the named throttlers: `auth` (per IP) and `user` (per session
│   │                              #   user); USER_THROTTLER, THROTTLE_TTL_MS
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
│   ├── posts/
│   │   ├── dto/
│   │   │   ├── create-post.dto.ts          # CreatePostDto { body } — @IsPostBody()
│   │   │   ├── create-comment.dto.ts       # CreateCommentDto { body } — @IsPostBody()
│   │   │   ├── list-posts-query.dto.ts     # ListPostsQueryDto { cursor?, limit? (1–50) } — feed,
│   │   │   │                               #   a user's posts and comments
│   │   │   ├── post-response.dto.ts        # PostResponseDto { id, body, createdAt, author,
│   │   │   │                               #   likeCount, commentCount, likedByMe }
│   │   │   ├── post-author-response.dto.ts # PostAuthorResponseDto { username } (posts + comments)
│   │   │   ├── post-page-response.dto.ts   # PostPageResponseDto { items, nextCursor }
│   │   │   ├── comment-response.dto.ts     # CommentResponseDto { id, body, createdAt, author }
│   │   │   ├── comment-page-response.dto.ts  # CommentPageResponseDto { items, nextCursor }
│   │   │   └── like-state-response.dto.ts  # LikeStateResponseDto { liked, likeCount }
│   │   ├── posts.rules.ts         # authoritative body rules: BODY_MAX_LENGTH (280), code-point
│   │   │                          #   bodyLength, normalizeBody (trim), @IsPostBody()
│   │   ├── pagination.ts          # keyset cursor: encodeCursor / decodeCursor, PAGE_SIZE (20),
│   │   │                          #   MAX_PAGE_SIZE (50), resolvePageSize
│   │   ├── posts.module.ts        # Posts / Feed / Comments controllers; exports PostsService
│   │   ├── posts.controller.ts    # POST /posts, GET/DELETE /posts/:id, PUT/DELETE /posts/:id/like
│   │   ├── feed.controller.ts     # GET /feed
│   │   ├── comments.controller.ts # GET/POST /posts/:postId/comments, DELETE …/:commentId
│   │   ├── posts.service.ts       # create, getById, delete (own), setLiked, feed, listByAuthor,
│   │   │                          #   countByAuthor; feedAuthorIds (the follows extension point)
│   │   ├── comments.service.ts    # list, create, delete (own)
│   │   ├── posts.repository.ts    # Prisma access for Post + Like; countsFor (batched counts)
│   │   └── comments.repository.ts # Prisma access for Comment
│   └── users/
│       ├── dto/
│       │   ├── user-response.dto.ts        # UserResponseDto { id, email, username }
│       │   ├── profile-response.dto.ts     # ProfileResponseDto { username, bio, createdAt,
│       │   │                               #   postCount }
│       │   ├── my-profile-response.dto.ts  # MyProfileResponseDto { id, email, username, bio,
│       │   │                               #   createdAt, postCount } — the caller's own profile
│       │   └── update-profile.dto.ts       # UpdateProfileDto { username?, bio? }
│       ├── username.rules.ts      # authoritative username/bio rules: RESERVED_USERNAMES,
│       │                          #   normalizers, @IsUsername() / @IsBio() DTO decorators
│       ├── users.module.ts        # UsersController; imports PostsModule; exports UsersService
│       ├── users.controller.ts    # GET /users/:username, GET /users/:username/posts,
│       │                          #   PATCH /users/me
│       ├── users.service.ts       # create (argon2id hash, 409 on duplicate), lookups,
│       │                          #   getProfile, listPosts, updateProfile (+ postCount)
│       └── users.repository.ts    # Prisma access for User
└── generated/prisma/      # `npx prisma generate` output — gitignored, never hand-edited
```

No other `common/` subfolder exists yet. The domain modules are `modules/users/` (users are
created through the auth flow; `UsersController` serves profiles and a user's posts) and
`modules/posts/` (posts, likes and comments in one module). `UsersModule` imports `PostsModule`
(for `postCount` and `GET /users/:username/posts`), never the other way round — no cycle. Add
more, in
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
production data). The posts change only adds tables: a plain `npx prisma db push`.

Posts models — every relation is `onDelete: Cascade`: deleting a post removes its likes and
comments, deleting a user removes their posts, likes and comments (hard delete, no soft delete).

- `Post { id cuid, authorId → User, body, createdAt }` — `@@index([authorId, createdAt])` (one
  author's posts newest first) and `@@index([createdAt])`. The latter is unused while the feed's
  author set is just you; it lets SQLite walk time order once follows make the author list large.
- `Like { userId → User, postId → Post, createdAt }` — `@@id([userId, postId])` (one like per
  user per post; also what makes likes idempotent) + `@@index([postId])` for the counts.
- `Comment { id cuid, postId → Post, authorId → User, body, createdAt }` —
  `@@index([postId, createdAt])`. `authorId` is deliberately **not** indexed: no query filters by
  it, only a user-delete cascade scans it.

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
- **Throttling.** `@nestjs/throttler`: one global `ThrottlerModule.forRoot` in `AuthModule`
  with the named throttlers of `auth/throttlers.ts`; `ThrottlerGuard` is applied per handler
  (`@UseGuards`), never globally → 429 `Too many requests, please try again later`. Sign-up and
  sign-in get the `auth` throttler (5 requests / 60 s per client IP, per route) — see Throttling
  under Posts below for the design.

**Profiles** (`src/modules/users/`, `UsersController`; both routes session-gated, no
`@Public()`).

- **Endpoints.** `GET /users/:username` → `ProfileResponseDto { username, bio, createdAt,
  postCount }` (case-insensitive lookup; never email or id) or 404 `User not found`. `PATCH
  /users/me` `{ username?, bio? }` → `MyProfileResponseDto { id, email, username, bio, createdAt,
  postCount }`; 409 `Username is already taken`. `postCount` comes from
  `PostsService.countByAuthor`. The target id comes only from `@CurrentUser()`; unknown
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

**Posts** (`src/modules/posts/`; a user's posts on `UsersController`). Every route is
session-gated (no `@Public()`); author and viewer ids come only from `@CurrentUser()` — an
`authorId` in a body is stripped by the whitelist.

- **Endpoints.** `POST /posts` `{ body }` → 201 `PostResponseDto` (10/min per user).
  `GET /posts/:id` → `PostResponseDto` / 404 `Post not found`. `DELETE /posts/:id` → 204; 403
  `You can only delete your own posts`; 404. `GET /feed?cursor=&limit=` and
  `GET /users/:username/posts?cursor=&limit=` → `PostPageResponseDto`, newest first (the latter
  404 `User not found`; `GET /users/me/posts` is a 404 like `GET /users/me`).
  `PUT` / `DELETE /posts/:id/like` → 200 `LikeStateResponseDto { liked, likeCount }`, idempotent,
  404 if the post is missing, not throttled. `GET /posts/:postId/comments?cursor=&limit=` →
  `CommentPageResponseDto`, oldest first (404 unknown post). `POST /posts/:postId/comments`
  `{ body }` → 201 `CommentResponseDto` (20/min per user; 404 unknown post).
  `DELETE /posts/:postId/comments/:commentId` → 204; 403 `You can only delete your own comments`;
  404 `Comment not found`. `GET /users/:username` and `PATCH /users/me` gain `postCount`
  (`PostsService.countByAuthor`). The comments routes have one more segment than `:id` and a
  literal `comments` where the like routes have `like`, so the controllers never clash.
- **Body rules** (`posts.rules.ts`, shared by posts and comments; the frontend's `lib/text.js`
  counts the same way). `@IsPostBody()` = a trimming `@Transform` + `@IsString()` + a
  `ValidateBy` of 1–280 **code points** (`Array.from(value).length`, so an emoji is 1).
  class-validator's `@Length` / `@MaxLength` count UTF-16 units, hence not used. A blank body is
  0 after trimming → 400.
- **Keyset pagination** (`pagination.ts`). The cursor is opaque: base64url of the JSON
  `[createdAt ISO, id]` of a page's last item. Ordering is over `(createdAt, id)`, so equal
  timestamps never skip or duplicate across pages. Repositories fetch `limit + 1` rows strictly
  after the cursor — posts newest first (`createdAt < c OR (createdAt = c AND id < c.id)`,
  `desc, desc`), comments oldest first (the `>` mirror, `asc, asc`); the extra row only says a
  next page exists (`nextCursor` = the last returned item's cursor, else null). `decodeCursor`
  rejects anything `encodeCursor` couldn't have produced (non-base64url, wrong shape,
  non-canonical ISO) with 400 `Invalid cursor`, before any query — an empty `cursor=` included
  (the frontend omits the param for the first page). `limit` defaults to 20; the query DTO
  rejects anything outside 1–50 with 400.
- **Counts without N+1.** `PostsRepository.countsFor(postIds, viewerId)` returns `likeCount`,
  `commentCount` and `likedByMe` for a whole page in three queries (a `groupBy` on likes, one on
  comments, and the viewer's likes among those ids), zero-filled — a page is one `findMany` plus
  those three, whatever its size. `create` runs none (a new post has no activity).
- **Feed author set.** `PostsService.feedAuthorIds(viewerId)` is the single place that decides
  whose posts are in a feed — `[viewerId]` today. The follows feature adds followed users' ids
  there and nowhere else; `feed()` and `listByAuthor()` share one private `page()`.
- **Likes are idempotent.** `PostsRepository.like` is a plain `create` with P2002 (the composite
  primary key) swallowed: of N concurrent identical requests one inserts, the rest mean "already
  liked". Prisma's `upsert` isn't used — unless it maps to a native upsert it runs
  read-then-create and can itself throw P2002. `unlike` is a `deleteMany` (0 rows is fine). The
  service checks the post exists first and maps a P2003 (post deleted between the check and the
  insert) to 404, not 500; the response re-counts the likes.
- **Deletes.** Both deletes load the row first (404 missing, 403 not yours), then delete with
  `deleteMany({ id, authorId })`, so a concurrent delete surfaces as 404. A comment delete also
  checks the comment belongs to the post in the path — a comment on another post is a 404, never
  deleted through the wrong post's URL. Comment create maps P2003 to 404 like likes do.
- **Throttling** (`auth/throttlers.ts`). `ThrottlerGuard` evaluates **every** configured
  throttler on each guarded route, so each named throttler selects itself with `skipIf`:
  - `auth` — 5 / 60 s, keyed by client IP (the default tracker); skipped when `req.user` is set.
    It exists for the `@Public()` sign-in / sign-up routes, where `AuthGuard` never sets
    `req.user`, so skipping on it is safe: a signed-in caller can't use their session to dodge
    the sign-in limit (the global `AuthGuard` runs before route guards, and on public routes it
    returns before resolving any user).
  - `user` — keyed `user:<id>` (the session user), so users behind one IP don't share a budget
    and switching IPs doesn't reset it; skipped without a session user (its tracker throws 401
    rather than put anonymous requests in one "undefined" bucket). Default 10 / 60 s; each route
    sets its own with `@Throttle({ [USER_THROTTLER]: { limit, ttl: THROTTLE_TTL_MS } })` — create
    post 10, create comment 20.

  Counters are per route (the storage key includes controller + handler). A request rejected by
  validation (400) still counts.
- **Nested response DTOs need `@Type`.** `PostResponseDto.author`, `CommentResponseDto.author`
  and both page DTOs' `items` carry `@Type(() => …)`. Without it `excludeExtraneousValues`
  copies the nested value as an untyped plain object, bypassing the inner `@Expose()` whitelist —
  a probe leaked the author's email and `passwordHash`. Guarded by
  `posts/dto/__tests__/post-response.dto.spec.ts` (and the page / comment DTO specs) through the
  real interceptor, plus the e2e leak guard (Tests below).

**Error handling.** A single global `AllExceptionsFilter`
(`src/common/filters/all-exceptions.filter.ts`) catches everything and normalizes the
response to `{ statusCode, message, timestamp, path }`. Paired with a global
`ValidationPipe` (`whitelist: true, transform: true`, **no** implicit conversion) — DTOs use
`class-validator` / `class-transformer` (see `src/auth/dto/`, `src/modules/users/dto/`). Values
keep the JSON type the client sent, so a number or boolean in a string field fails `@IsString()`
with a 400 instead of being coerced (`test/validation.e2e-spec.ts`). A field that genuinely needs
conversion — numeric query params always arrive as strings — declares it explicitly with
`@Type(() => Number)`.

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
internal service types (`PublicUser`, `PublicProfile`, `MyProfile`, `AuthenticatedUser`,
`PostView`, `CommentView`, `PostPage`, `LikeState`) directly. 204 endpoints (`POST
/auth/sign-out`, the post and comment deletes) return `void` and need no DTO. A nested object or
array in a response DTO needs `@Type(() => NestedDto)` — see Posts above.

**CORS.** `app.enableCors({ origin: [FRONTEND_ORIGIN], credentials: true })` — an
exact-match allowlist of one origin (never `*`); any other origin gets no
`Access-Control-Allow-Origin`. Required for the Vite frontend (`:5173`) to call the API
(`:3000`) with the session cookie.

**Security headers.** `helmet()` defaults.

**Observability.** [NestJS Observe](https://observe.nestjs.com) APM, optional — only
initializes when both `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` are set to a
non-empty value in `backend/.env`; see the Config section above.

## Tests

Unit specs (`*.spec.ts`, Vitest) live in a `__tests__/` folder next to the code they cover —
`src/auth/__tests__/auth.service.spec.ts`, `src/modules/users/dto/__tests__/…` — never loose
beside the source file, so a module's folder lists only its code. They import the code under test
with `../`. Service specs mock the repository through `Test.createTestingModule`; no real database
in a unit spec. E2e (`test/app.e2e-spec.ts`, `npm run test:e2e`) boots the real `AppModule` through
`configureApp` against a dedicated SQLite file, `prisma/e2e.db` (git-ignored), never the dev DB:
`vitest.config.e2e.ts` sets `DATABASE_URL` (from `test/e2e-database.ts`) — it wins over `.env`,
since dotenv/`@nestjs/config` don't override an already-set variable — and `test/global-setup.ts`
deletes the file and recreates it with a plain `prisma db push` before each run, then deletes it
afterwards. A guard test asserts the connected file is `e2e.db`. `tsconfig.build.json` excludes `**/*spec.ts`, so
nothing under `__tests__/` reaches `dist/`.

`test/posts.e2e-spec.ts` covers the posts feature end to end: every endpoint's exact keys
(`author` is `{ username }` only), body rules (trim, code points — 280 emoji accepted), 401 /
foreign-Origin 403 / not-yours 403 / 404, both rate limits (other users unaffected), paging walks
over tied timestamps (49 posts, 27 comments — no skips, no duplicates, null cursor at the end),
bad `limit` / `cursor` (`cursor=` included) → 400, like idempotency (10 concurrent PUTs store one
like), per-viewer `likedByMe`, cascades on delete, and `postCount` / `commentCount` tracking. It
builds a fresh app per test (throttle counters never carry over) and deletes the users it created
(their data cascades). **Leak guard:** every request goes through a `call` helper that records
the response, and `afterEach` asserts no body has a `passwordHash` / `tokenHash` key anywhere,
nor an `email` key or any test user's email address — except `PATCH /users/me` and
`GET /auth/me`, the caller's own. A self-check test proves the guard sees what was recorded.

## Open questions

- `oxlint.json` currently turns `@typescript-eslint/no-explicit-any` **off**, while
  [[Code quality]] says to avoid `any`. Not reconciled — flagging so it isn't
  silently re-decided; revisit if `any` actually starts showing up in reviews.
- Repository layer: built — `UsersRepository` (`modules/users/`) and
  `SessionsRepository` (`auth/`). Repositories are the only layer injecting
  `PrismaService` (plain `@Injectable()` classes — no interface, no injection token),
  enforced by `.claude/review-contract.md` §B.
- The global `ValidationPipe` has `enableImplicitConversion`, so a JSON number in a string field
  is coerced before `@IsString()` runs (`POST /posts { body: 123 }` → 201 with body `"123"`).
  App-wide; Alejandro to decide: drop implicit conversion (adding explicit `@Type(() => Number)`
  where query numbers need it) or accept it.
- Throttling keys on the client IP as Express sees it; there's no `trust proxy` setting,
  so behind a reverse proxy every client would share one bucket. Revisit when deployed.
