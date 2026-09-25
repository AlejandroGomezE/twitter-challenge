# The Flock Twitter: a Twitter clone

A full-stack Twitter clone built for The Flock's take-home challenge. A NestJS + Prisma API over
SQLite and a Vite + React single-page app. Users sign up, post 280-character tweets, follow each
other, like and comment, search for people, and get notifications and live timeline updates over
Server-Sent Events. The whole stack runs with one `docker compose up --build`.

This README covers the **technical decisions**: what was built, why, and what it can't do yet.
**How to run it** lives in [`Runbook.md`](Runbook.md), which is the only place setup is described.

## Start here

```bash
docker compose up --build        # then open http://localhost:8080
```

Sign in as **`demo@example.com` / `password1234`**. A fresh Docker volume is seeded with demo data
on first start. For running without Docker (`scripts/be-local` + `scripts/fe-local`), the first-time
setup, tests and every endpoint, see the [Runbook](Runbook.md):
[Run with Docker](Runbook.md#run-with-docker),
[First-time setup](Runbook.md#first-time-setup-fresh-clone--new-machine),
[Backend](Runbook.md#backend-backend), [Frontend](Runbook.md#frontend-frontend).

Before you start, check [Known setup gotchas](#known-setup-gotchas).

---

## 1. What it is

| Challenge item | Status | Where |
|---|---|---|
| Authentication (sign-up, sign-in, sign-out) | Built, custom sessions | `backend/src/auth/`, `frontend/src/lib/auth/`, [feature](features/user-authentication/feature.md) |
| User profiles (username, display name, bio, counts, edit) | Built | `backend/src/modules/users/`, `pages/Profile.tsx`, `pages/EditProfile.tsx`, [feature](features/user-profile/feature.md) |
| Tweets (280 chars, delete your own) | Built | `backend/src/modules/posts/`, `components/feed/`, [feature](features/twitter-posts/feature.md) |
| Timeline | Built: **Following** (you + people you follow) and **For you** (everyone) | `feed.controller.ts`, `pages/Home.tsx` |
| Follow / unfollow, follower and following lists | Built | `backend/src/modules/follows/`, [feature](features/follow-users/feature.md) |
| Likes | Built, optimistic in the UI | `posts.repository.ts`, `PostCard.tsx` |
| Search (users by username or display name) | Built: typeahead and an Explore page | `search.controller.ts`, `pages/Explore.tsx`, [feature](features/user-search/feature.md) |
| Responsive UI | Built: side nav from `lg`, right rail at `xl`, bottom nav and compose button on mobile | `components/layout/`, [feature](features/social-feed-ui/feature.md) |
| Bonus: realtime | Built over SSE (`GET /events`) | `backend/src/modules/realtime/`, `frontend/src/lib/realtime/`, [feature](features/realtime-updates/feature.md) |
| Bonus: notifications | Built: follow, like and comment, with an unread badge | `backend/src/modules/notifications/`, [feature](features/notifications/feature.md) |
| Bonus: Docker | Built: `compose.yaml` with two production-like images | [feature](features/docker-compose-stack/feature.md) |
| Extras | Comments, a post detail page, "Who to follow" suggestions, seeded demo data | [seed-data](features/seed-data/feature.md) |

Not built: retweets, bookmarks and share, which are shown as disabled "Coming soon" buttons. Also
missing: media uploads, direct messages, password reset and email verification. See
[Trade-offs and known limitations](#9-trade-offs-and-known-limitations).

---

## 2. Stack and why

**Backend: NestJS 12, Prisma 7, SQLite** (through `@prisma/adapter-better-sqlite3`).

- NestJS gives modules, dependency injection, a global guard, pipes, interceptors and filters out
  of the box. Those are where auth, validation, response whitelisting and error normalization live,
  so a feature module only holds its own logic.
- Prisma gives a typed client generated from one schema file (`backend/prisma/schema.prisma`), so a
  query can't drift from the model without a type error. Prisma 7 needs an explicit driver adapter,
  which is wired in `src/database/prisma.service.ts`.
- The schema is applied with `prisma db push`. There is no migrations folder, which is a
  prototype-stage choice.
- Validation uses `class-validator` DTOs, plus Zod for environment variables at boot.
  Passwords are hashed with `argon2`, `helmet` sets security headers, and `@nestjs/throttler`
  handles rate limits. `@nestjs/event-emitter` passes domain events to notifications and realtime.

**Why SQLite, and not the Postgres the project started on.** The first PR
([migrate-to-sqlite](features/migrate-to-sqlite/feature.md), #1) swapped Postgres for SQLite before
any model existed, so it was a driver change with no data to migrate. The reasons
([Decisions](features/readme-technical-decisions/feature.md)):

- **Zero setup for evaluators.** There's no database server to install or run: clone,
  `npx prisma db push`, and it works. That keeps the Runbook simpler and harder to break.
- **Fast, isolated tests.** The e2e suite gets its own file database (`backend/prisma/e2e.db`) and
  never touches dev data. Running the tests needs no container.
- **A simpler Docker stack.** There's no separate database container; the database is a file on a
  named volume.

The costs are in the [limitations](#9-trade-offs-and-known-limitations): one writer at a time,
`LIKE` that only case-folds ASCII, and no enums (`Notification.type` is validated in code).

**Going back to Postgres** would be:

- datasource `provider = "postgresql"`, with `@prisma/adapter-pg` instead of the better-sqlite3
  adapter in `PrismaService` and `prisma7.config.ts`;
- a Postgres service in `compose.yaml`;
- migrations instead of `db push` for anything with real data;
- reworking the one raw SQL query, user search in `users.repository.ts`, because Postgres `LIKE` is
  case-sensitive, so it would need `ILIKE` or `lower()`;
- optionally turning `Notification.type` into an enum.

Prisma queries elsewhere are provider-neutral.

**Frontend: Vite 8, React 19, strict TypeScript, TanStack Query 5, Tailwind CSS 4, shadcn/ui,
react-router.**

- Vite for fast dev and a static bundle that nginx serves.
- TanStack Query owns all server state: caching, infinite pages, optimistic likes and follows with
  rollback, and a central 401 handler in `src/app/query-client.ts`. That keeps components free of
  hand-rolled fetch/`useEffect` state.
- shadcn/ui components are copied into `src/components/ui/`, so they are owned code built on Radix
  accessibility primitives. The project's rule is to reuse one before writing a new component
  ([decision](knowledge/decisions/shadcn-component-preference.md)).
- Forms use `react-hook-form` + Zod, and the schemas mirror the backend rules.

**Tests: Vitest on both sides.** The frontend adds React Testing Library and MSW. MSW fakes the API
at the network layer, so tests go through the real `apiClient`. See [Testing](#7-testing).

---

## 3. Architecture

```
backend/src/
  auth/            sign-up/in/out, sessions, global AuthGuard, @Public(), @CurrentUser(), throttlers
  modules/
    users/         profiles, PATCH /users/me, user search (/search/users)
    posts/         posts, feeds, likes, comments, keyset pagination
    follows/       follow/unfollow, follower/following lists, suggestions
    notifications/ event listener -> Notification rows, list / unread count / mark read
    realtime/      in-memory SSE hub, GET /events, event listener -> stream messages
  common/          domain events, AllExceptionsFilter, ResponseSerializerInterceptor
  config/          configuration + Zod env validation
  database/        PrismaService (SQLite adapter), seed
  app.setup.ts     HTTP pipeline shared by main.ts and the e2e suite

frontend/src/
  app/             App, router, providers, query client (central 401 handling)
  routes/          ProtectedRoute, PublicOnlyRoute
  pages/           Home, Explore, Notifications, PostDetail, Profile, EditProfile, SignIn/Up/Out
  components/      ui/ (shadcn), layout/ (app shell, nav, right rail), feed/ (composer, post card, comments)
  hooks/           TanStack Query hooks: posts, comments, follows, profile, search, notifications
  lib/api/         apiClient (fetch, credentials: 'include'), endpoint modules, cache helpers, types
  lib/auth/        AuthProvider, useAuth()
  lib/realtime/    RealtimeProvider (one EventSource), new-posts store behind Home's pill
  test/            MSW server + default handlers, renderWithProviders, a fake EventSource
```

**Request path.** `configureApp()` in `src/app.setup.ts` installs the same pipeline in the server and
in e2e tests:

- `helmet`, then `cookie-parser`;
- CORS allowing only `FRONTEND_ORIGIN`, with credentials;
- a global `ValidationPipe` with `whitelist` and `transform` but no implicit conversion. A number
  sent to a string field is a 400, and numeric query params opt in with `@Type(() => Number)`.

Then:

- the global `AuthGuard` checks the session;
- the **controller** binds, validates, calls one service method and shapes the response;
- the **service** holds the business rules;
- the **repository** is the only layer that touches `PrismaService`.

**Responses fail closed.** Each handler declares `@SerializeOptions({ type: XResponseDto })`, and
the global `ResponseSerializerInterceptor` emits only the `@Expose()`d fields. A body without a
declared DTO is a 500 instead of an unfiltered object, so a Prisma row (with `passwordHash`) can't
leak by accident. All errors go through one `AllExceptionsFilter` into
`{ statusCode, message, timestamp, path }`.

**Cross-module side effects go through events.** Posts and follows emit domain events after a
successful write (`src/common/events/domain-events.ts`) and don't know who listens. The
notifications and realtime modules subscribe.

Depth: [backend architecture](knowledge/infra/backend-architecture.md),
[frontend architecture](knowledge/infra/frontend-architecture.md),
[code quality](knowledge/infra/code-quality.md),
[UI component inventory](knowledge/infra/ui-component-inventory.md).

---

## 4. Timeline and follow graph

### Data model (`backend/prisma/schema.prisma`)

- **`Follow { followerId, followingId, createdAt }`** is a plain edge table.
  - Composite primary key `@@id([followerId, followingId])`: one follow per pair. Its
    `followerId` prefix serves "whom does X follow".
  - `@@index([followingId, createdAt])` backs the followers list, newest first.
  - `@@index([followerId, createdAt])` backs the following list, newest first.
  - Both relations cascade on user delete. Edges key on user ids, so renaming a username keeps
    them.
- **`Post { id, authorId, body, createdAt }`** has `@@index([authorId, createdAt])` (one author's
  posts, newest first) and `@@index([createdAt])` (the For you feed walks time order).
- **`Like`** has a composite PK `(userId, postId)` and `@@index([postId])`.
  **`Comment`** has `@@index([postId, createdAt])`.

**Follow and like are idempotent and race-safe.** `PUT /users/:username/follow` and
`PUT /posts/:id/like` do a plain insert and treat a primary-key conflict (Prisma `P2002`) as
"already there". Concurrent duplicates can't double-insert, and a domain event (and therefore a
notification) is emitted only when a row was really inserted.

### Feeds: fan-out on read

There is no materialized timeline. A feed page is computed when it's requested
(`posts.service.ts` → `posts.repository.ts`):

1. **Who's in the feed.** Following = the viewer plus every user they follow: one query on
   `Follow` (`followedIds`). For you skips this step and has no author filter.
2. **One page of posts.** Posts where `authorId IN (...)` (Following only), ordered by
   `createdAt DESC, id DESC`, with `take = limit + 1`. The extra row only tells whether a next page
   exists. The author's `username` / `displayName` come from the same query.
3. **Counts and `likedByMe` for that page only.** Three queries run in parallel over the page's post
   ids: a like `groupBy`, a comment `groupBy`, and the viewer's likes. The number of queries doesn't
   depend on the page size (no N+1), and counts are never stored, so they can't drift.

**Pagination is keyset, not offset.** The cursor is opaque: base64url-encoded JSON
`[createdAt ISO, id]` of the page's last post (`src/modules/posts/pagination.ts`). The next page is
`createdAt < c.createdAt OR (createdAt = c.createdAt AND id < c.id)`, so posts with equal
timestamps are never skipped or repeated, and a post created meanwhile doesn't shift later pages.

- Page size is 20 by default, and `limit` can be 1–50.
- A malformed or empty cursor is a 400 before any query runs.
- The same scheme pages profiles, comments, follow lists and notifications. User search uses keyset
  paging on `username`.

**Why fan-out on read.** At this scale (30 seeded users, one SQLite file) it's the simplest correct
design:

- Follow and unfollow take effect on the next fetch, with no backfill or cleanup.
- Deleting a post is a single row delete (likes, comments and notifications cascade).
- There is no second copy of the data to keep consistent.

Fan-out on write, a per-user timeline table filled when someone posts, makes reads cheap but writes
cost O(followers). High-follower accounts then need a hybrid approach.

**Where it stops scaling.** The Following query grows with the number of accounts a user follows.
The `IN` list gets long, and the database has to merge many authors' time ranges (or walk the
global `createdAt` index and filter) on every page. No query plans have been measured. With
thousands of follows per user or heavy read traffic, the next steps would be:

- a cached or materialized home timeline;
- fan-out on write for normal accounts and read-time merge for very large ones;
- Postgres for concurrent writes.

---

## 5. Authentication

Custom, with no third-party auth provider (`backend/src/auth/`).

- **Passwords.** argon2id (`memoryCost 19456`, `timeCost 2`, `parallelism 1`; `ARGON2_OPTIONS` in
  `users.service.ts`). Passwords are 12–128 characters. The salt is inside the hash string.
- **Sessions are server-side.** Sign-up and sign-in create a random 32-byte token (base64url). Only
  its **SHA-256** goes into `Session.tokenHash`, so a database leak doesn't hand out live sessions.
  Sessions last 7 days from creation; the expiry is fixed, not extended on use. Expired rows are
  deleted when they are looked up, and swept whenever a new session is created.
- **Cookie.** `sid`, `httpOnly`, `SameSite=Lax`, `path=/`, and `Secure` only when
  `NODE_ENV=production`. Docker defaults to `development` because some browsers (Safari) drop
  `Secure` cookies over plain `http://localhost`. The frontend never sees the token: `apiClient`
  sends `credentials: 'include'`.
- **Gated by default.** `AuthGuard` is registered globally (`APP_GUARD`). Every route needs a live
  session unless it is marked `@Public()`, and only sign-up, sign-in and sign-out are. Handlers read
  the user with `@CurrentUser()`, and every write is scoped to the session user, never to an id sent
  in the request.
- **CSRF.** The same guard rejects POST, PUT, PATCH and DELETE whose `Origin` isn't exactly
  `FRONTEND_ORIGIN` with a 403. This applies to public routes too, which covers login CSRF. A
  missing `Origin` (non-browser clients) is allowed. `SameSite=Lax` and the exact-origin CORS
  allowlist add further protection.
- **No account enumeration on sign-in.** An unknown email and a wrong password both return the same
  401 `Invalid email or password`. For an unknown email the service still verifies against a dummy
  argon2 hash (computed at module init), so timing matches too. Sign-up does return 409 for a taken
  email. That trade-off is recorded in the auth feature, and the rate limit mitigates it.
- **Rate limits.** Sign-up and sign-in are limited to 5 per minute per IP, per route. Signed-in
  writes are limited per user id: posts 10 per minute, comments 20 per minute, and follow/unfollow
  30 per minute each. Likes aren't limited.
- **Frontend guards.** `ProtectedRoute` wraps everything except `/sign-in`, `/sign-up` and
  `/sign-out`:
  - Signed-out visitors go to `/sign-in` and come back to the route they asked for (open redirects
    are rejected).
  - `PublicOnlyRoute` sends signed-in users away from the auth pages.
  - Only a 401 from `/auth/me` means "signed out". A 500 or a network error shows "Couldn't reach
    the server" with Retry.
  - A 401 on any other request resets the user and drops cached queries centrally.

**Why sessions and not JWT** ([decision](features/user-authentication/feature.md)):

- Sign-out deletes the session row, so revocation is real and immediate. Realtime streams re-check
  the session on every heartbeat and close within 25 s.
- Nothing readable by JavaScript is ever issued.
- There is no refresh-token scheme to get right.

The cost is one indexed lookup per request (`tokenHash` is unique), which is negligible here.

---

## 6. Bonus features: design notes

### Realtime over SSE

`GET /events` is one multiplexed `text/event-stream` per tab, gated by the same cookie session.

| Event | Sent to |
|---|---|
| `post.created` `{ id, following }` | Every connected user except the author |
| `post.deleted` `{ id }` | Every connected user except the author |
| `post.counts` `{ id, likeCount, commentCount }` | Every connected user except the actor |
| `notifications.changed` `{ unreadCount }` | The recipient only |

Payloads carry ids and counts only, never user data.

- **Why SSE rather than WebSockets.** Every push goes from server to client. SSE runs over plain HTTP
  with the existing cookie and CORS setup, `EventSource` reconnects on its own, and Nest supports it
  natively (`@Sse()`).
- **Hub.** An in-memory `RealtimeHub` maps each user to their open streams, at most 5 per user
  (opening a 6th closes the oldest). A `: ping` every 25 s re-validates the session.
- **Frontend.** New posts appear behind an "N new posts" pill instead of jumping into the list.
  Counts and deletions patch the TanStack Query cache, and the unread badge updates live. The actor
  is excluded from these events because their own client already applied the change
  optimistically.
- **No replay** (`Last-Event-ID`). After a reconnect the client refetches instead.

### Notifications

The challenge leaves this "intentionally ambiguous". The choices made
([feature Decisions](features/notifications/feature.md)):

- **Types.** `follow`, `like` and `comment` on your post. Your own actions never notify you.
- **Event-driven.** `NotificationsListener` subscribes to domain events through
  `@nestjs/event-emitter` with `async: true`. A failure is logged and never fails the like, follow
  or comment request.
- **One row per event**, with no "A and 3 others" grouping.
- **Retraction.** Unlike and unfollow delete the notification. Deleting the post, the comment or a
  user removes it through the FK cascade.
- **Read state.** `readAt` is set per row. Opening the page marks everything read, Twitter-style,
  through `POST /notifications/read { until }`. `until` is the newest `createdAt` the client has
  seen, so a notification that arrives while the page is open isn't marked read unseen. The nav
  badge reads `GET /notifications/unread-count` and updates over SSE.

### Docker

- `compose.yaml` builds two production-like images. The backend runs `node dist/main` as the
  non-root `node` user on `node:22-bookworm-slim`. The frontend is a static bundle on
  `nginx:alpine`.
- There is no hot reload; that stays with the local scripts.
- There is no database container. SQLite lives at `/data/app.db` on the named volume
  `twitter-clone_db-data`.
- On every start the entrypoint runs `prisma db push`, which never forces a lossy change. It then
  seeds the demo data **only if the database has no users** (`--if-empty`), so restarts never wipe
  data.
- The browser calls the API directly on `:3000`. There is no nginx `/api` proxy, which keeps the
  image static and avoids SSE buffering config.

Details: [Run with Docker](Runbook.md#run-with-docker).

---

## 7. Testing

| Layer | Where | What |
|---|---|---|
| Backend unit | `backend/src/**/__tests__/*.spec.ts` | Services, controllers, repositories, DTOs, guard, pagination, rules. Dependencies are mocked with `Test.createTestingModule`, with no database. |
| Backend e2e | `backend/test/*.e2e-spec.ts` | The real app through `configureApp()` and supertest, against a dedicated `prisma/e2e.db` that is rebuilt from the schema on every run and deleted afterwards. It never touches `dev.db`. |
| Frontend | `frontend/src/**/__tests__/*.test.{ts,tsx}` | Vitest, jsdom and React Testing Library. The API is faked with MSW at the network layer, and an unhandled request fails the test. A fake `EventSource` covers realtime. |

- **The auth flow end to end.** `test/app.e2e-spec.ts` covers:
  - sign-up setting the cookie and returning only the response DTO fields;
  - duplicate email or username → 409;
  - sign-in failing identically for an unknown email and a wrong password;
  - `/auth/me` and sign-out managing the session lifecycle;
  - an expired session → 401;
  - a foreign `Origin` → 403.

  Other e2e specs cover posts, follows, search, notifications, realtime, request validation and the
  seed.
- **Key frontend flows.**
  - Sign-in (`pages/__tests__/SignIn.test.tsx`: validation, the 401 and 429 messages, the redirect
    back to the requested route).
  - Creating a tweet (`components/feed/__tests__/Composer.test.tsx`).
  - Following (`components/__tests__/FollowButton.test.tsx`, and
    `pages/__tests__/Profile.test.tsx` "follows another user from their profile").
  - Route guards (`app/__tests__/router.test.tsx`).
- **Coverage.** Run `npm run test:cov` in `backend/` and in `frontend/` (Vitest with v8). No
  coverage figure is quoted here because none has been measured on `main` yet.

Commands for each app: [Runbook, Backend](Runbook.md#backend-backend) and
[Runbook, Frontend](Runbook.md#frontend-frontend).

---

## 8. Repository layout

```
backend/     NestJS API: src/, prisma/schema.prisma, test/ (e2e), Dockerfile, docker-entrypoint.sh
frontend/    Vite + React SPA: src/, Dockerfile, nginx.conf
compose.yaml the whole stack in Docker
scripts/     be-local, fe-local, down-be, down-fe, check-env (thin wrappers around npm scripts)
Runbook.md   how to set up, run and test everything
knowledge/   architecture and decision docs (infra/, decisions/)
features/    one feature.md per feature: plan, tasks, decisions, follow-ups, log
.claude/     the Claude Code workflow: skills, agents, review contract
```

---

## 9. Trade-offs and known limitations

**Architecture**

- **Single instance only.**
  - The SSE hub is in memory, so a second backend process wouldn't see the first one's streams.
    Scaling out needs a shared pub/sub such as Redis.
  - The rate-limit counters (`@nestjs/throttler`'s default storage) are also per process.
  - SQLite allows one writer at a time.

  None of this matters for one container, but it rules out horizontal scaling as built.
- **Fan-out on read.** Following-feed cost grows with how many accounts a user follows (see
  [section 4](#4-timeline-and-follow-graph)).
- **No migrations.** `prisma db push` only. A change that would lose data needs a reset (locally
  `--force-reset`; in Docker `docker compose down -v`).
- **Throttling by IP without `trust proxy`.** Behind a reverse proxy every client would share one
  sign-in/sign-up bucket.
- **Realtime gaps.** No replay of missed events. Notifications removed by a cascade send no
  `notifications.changed`, so the badge catches up on its next refetch. Open post-detail pages
  don't stream new comments, only counts.

**Product scope**

- **Auth is minimal.** No password reset, no email verification, and no lockout beyond the rate
  limit. Sessions last 7 days from sign-in, with no "remember me" option and no list of active
  sessions.
- **Not built:** retweets, bookmarks and share (disabled "Coming soon" buttons), media uploads
  (avatars are a placeholder: the initial on a colour derived from the username), DMs, hashtags,
  and search over tweet text (search is users only).
- **Search** matches substrings with SQLite `LIKE`. Case folding works for ASCII letters only, and
  results aren't ranked.
- **Notifications.** No grouping. Like → unlike → like creates a fresh notification each time.
- **Frontend.** The main JS chunk (about 680 kB minified) is over Vite's 500 kB warning, because
  there's no route-level code splitting yet.

Also see [`.claude/ROADMAP.md`](.claude/ROADMAP.md) and the `## Follow-ups` section of each
`features/*/feature.md`.

### Known setup gotchas

The [Runbook](Runbook.md) is the source for the steps; these are the things most likely to trip a
fresh setup.

- **Node version.** Use Node 22.12+ (22 LTS, pinned in `.nvmrc`) or Node 24. Older versions fail:
  the frontend's Vitest and the backend's `better-sqlite3` require them. `engines` in both
  `package.json` files and `scripts/check-env` enforce the same range.
- **Native build.** `npm install` in `backend/` compiles `better-sqlite3` from source, so it needs a
  C/C++ toolchain (Xcode Command Line Tools on macOS, `build-essential` + `python3` on Linux).
- **Docker is the zero-setup path.** It needs no host Node, npm or Prisma step.

---

## 10. AI usage and development process

**Tool.** Only **Claude Code** was used, driven by Alejandro through a small harness committed in
[`.claude/`](.claude/README.md). No other AI tools were used.

**The flow** ([`.claude/WORKFLOW.md`](.claude/WORKFLOW.md)) has four phases, one skill each:

| Phase | Skill | What happens |
|---|---|---|
| Frame | [`/feature`](.claude/skills/feature/SKILL.md) | Agree the slug and scope, then write `features/<slug>/feature.md` with the touched surface and acceptance criteria. |
| Build | [`/implement`](.claude/skills/implement/SKILL.md) | Split the plan into tasks and run them through an `implementer` → `reviewer` loop, up to 3 independent tasks in parallel, never two on overlapping files. |
| Verify | [`/review-feature`](.claude/skills/review-feature/SKILL.md) | Run the real app and check each acceptance criterion against it, then stop the servers. Anything wrong goes back to Build. |
| Close | [`/close-feature`](.claude/skills/close-feature/SKILL.md) | Write the tests the change needs, open the PR, run a [`/review-pr`](.claude/skills/review-pr/SKILL.md) pass, and merge only on Alejandro's explicit go-ahead. |

**Pieces that keep it honest:**

- **Agents.** [`implementer`](.claude/agents/implementer.md) implements exactly one task or stops
  with `BLOCKED`. [`reviewer`](.claude/agents/reviewer.md) is read-only and approves or rejects
  against the task. A **fresh reviewer is spawned for every review**, so it never grades work it has
  already seen, while a rejected task goes back to the same implementer.
- **Review contract.** [`.claude/review-contract.md`](.claude/review-contract.md) is one rulebook:
  severities, "a finding names a file and line", and stack rules such as repository-only Prisma
  access, response DTOs on every endpoint, and no unrequested `@Public()`.
- **Per-feature state.** `features/<slug>/feature.md` holds the plan, tasks, dated **Decisions**
  (who decided what and why), **Follow-ups** and a log. A session can resume cold from it, and it is
  where most of the "why" in this README comes from.
- **Shared context.** [`knowledge/`](knowledge/README.md) holds the architecture docs agents read
  before writing code. [`.claude/CONVENTIONS.md`](.claude/CONVENTIONS.md) covers commit format,
  when to stop and ask, and leaving no dev servers running.

**How it shows in the history.** Every change landed as its own pull request, all merged:

- Features went through the full flow, each with its own [`features/<slug>/`](features/).
- Smaller refactors, fixes and UI changes went in as standalone PRs (for example the move to strict
  TypeScript, #15).
- #1 was squash-merged. From #2 on, PRs land as **merge commits** (the rule in `WORKFLOW.md`), so
  each feature branch's frame / build / verify / fix commits stay visible on `main`.
- Commits follow conventional-commit style. Apart from the merge commits, most are `chore`
  (feature-state bookkeeping such as `chore(<slug>): frame feature` / `closed`), followed by
  `feat`, `test`, `refactor`, `fix` and `docs`.

**Delegated vs checked by hand.**

- **Delegated to agents:** writing code and tests, the review loop, and PR review passes.
- **Decided by Alejandro:** scope and product decisions (each dated and attributed in a feature's
  Decisions), whether Verify passes, and every merge. Self-approval is impossible on GitHub, so his
  explicit "merge it" is the approval.
- **Checked against real runs, not just green unit tests.** Verify runs the actual app, and the
  Docker feature was checked with a real `docker compose up --build`. The layers catch different
  things:
  - Review caught the Prisma CLI and the runtime opening two different SQLite files.
  - A real `docker build` and boot showed the image couldn't start without `openssl`.
  - Close-phase tests exposed a broken "return to the requested route" after sign-in that Verify's
    probe had wrongly passed.

  Each is recorded in its feature's Decisions.
