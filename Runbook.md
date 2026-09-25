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
| Set up a fresh clone (deps, `.env`, Prisma DB) | see [First-time setup](#first-time-setup-fresh-clone--new-machine) |
| Check the whole environment | `scripts/check-env` |
| Run the **backend** locally (`:3000`) | `scripts/be-local` |
| Run the **frontend** locally (`:5173`) | `scripts/fe-local` |
| Stop the **backend** (incl. orphaned watchers) | `scripts/down-be` |
| Stop the **frontend** | `scripts/down-fe` |

**Try it locally:** run `scripts/be-local` and `scripts/fe-local`, open
http://localhost:5173 — you land on `/sign-in`; use "Create an account" (`/sign-up`). First time
after pulling the auth change, run `npx prisma db push` from `backend/` (see Backend → Auth);
after pulling the profile change, run `npx prisma db push --force-reset` instead (see Backend →
Profiles — it wipes the dev DB); after pulling the posts, the follows, the user-search
(display names) or the notifications change, a plain `npx prisma db push` is enough (additive — see
Backend → Posts / Follows / Search / Notifications).

---

## First-time setup (fresh clone / new machine)

The database is a local SQLite file (`backend/prisma/dev.db`), and both the file and the generated
Prisma client (`backend/src/generated/prisma`) are git-ignored. On a fresh clone neither exists yet,
and `npm install` doesn't create them because there's no `postinstall` hook. Run these once, from the repo root:

```bash
scripts/check-env                 # Node >= 20.11, npm; it will flag the missing node_modules/.env
cd backend
npm install                       # also builds the native better-sqlite3 / argon2 modules
cp .env.example .env              # DATABASE_URL=file:./dev.db is the right default
npx prisma generate               # writes the client to src/generated/prisma
npx prisma db push                # creates prisma/dev.db with every table in the current schema
cd ..
scripts/be-local                  # should boot on :3000 with no Prisma errors
```

- No database server is needed (no Docker, no Postgres). The Prisma CLI picks up
  `prisma7.config.ts` on its own, so you don't need a `--config` flag.
- This schema has no migrations folder. `db push` syncs the schema into the database directly.
- The "after pulling the X change, run `db push`…" notes further down are for existing
  databases. A fresh `db push` already creates the latest schema, so you can skip them,
  including the `--force-reset` one.
- The DB starts empty. Create an account through `/sign-up` in the frontend.
- To check it worked, run `npx prisma studio` from `backend/`. It opens a browser UI that lists the tables.
- To start over, delete `backend/prisma/dev.db*` and run `npx prisma db push` again.
  `npx prisma db push --force-reset` does the same thing.
- The e2e suite doesn't need any of this. It builds its own `prisma/e2e.db` on every run.

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
- **`scripts/down-be`** / **`scripts/down-fe`** — stop everything `be-local` / `fe-local`
  (or a plain `npm run start:dev` / `npm run dev`) left behind: every `node` process whose
  command line points into `backend/node_modules/` / `frontend/node_modules/` (the nest / vite
  CLIs), killed with its whole process tree (so the `node dist/main` a `nest --watch` spawned,
  and Vite's esbuild service, go with it), then checks the port (`PORT` from `backend/.env` or
  3000 / 5173) is free. A backend started some other way (e.g. `npm run start:prod`, `node
  dist/main`) is reported and left running, as is anything else holding the port — the script
  then exits non-zero. Safe to run when nothing is up. Shared logic lives in
  `scripts/lib/stop-dev.sh`.

---

## Backend (`backend/`)

Plain NestJS app (`npm`, not part of a workspace). Reads config via `dotenv/config`
from `backend/.env` (create it from `backend/.env.example`; it's git-ignored).

- **Env vars** (validated at boot by `src/config/environment.validation.ts`, a Zod
  schema — an invalid/missing required var throws on startup rather than failing
  silently later): `PORT` (optional, defaults to 3000), `DATABASE_URL` (required —
  see Database below), `NODE_ENV` (optional, `development` | `production` | `test`,
  default `development`; `production` makes the session cookie `Secure`),
  `FRONTEND_ORIGIN` (optional, default `http://localhost:5173` — the exact frontend
  origin, no path or trailing slash; it's the only origin CORS allows and the one the
  auth guard's Origin check accepts), `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` (optional —
  [NestJS Observe](https://observe.nestjs.com) APM; the `ObserveModule` only
  registers itself in `src/app.module.ts` when **both** are set to a non-empty
  value, so leaving them blank is a normal, supported way to run without APM).
- **Database**: Prisma (`prisma/schema.prisma` — models `User`, `Session`, `Post`, `Like`,
  `Comment`, `Follow`; config
  in `prisma7.config.ts`),
  driver-adapter based (Prisma 7 requires one — `@prisma/adapter-better-sqlite3` +
  `better-sqlite3`, wired in `src/database/prisma.service.ts`). SQLite is a local
  file, not a server — `DATABASE_URL` in `.env`/`.env.example` is a `file:` URL
  (default `file:./dev.db`), not a Postgres connection string. The database
  lives at `backend/prisma/dev.db` and is git-ignored (`.gitignore`'s
  `/prisma/*.db*`), so a fresh clone doesn't have it — create it with
  `npx prisma db push` (from `backend/`). Both `src/database/prisma.service.ts` and
  `prisma7.config.ts` explicitly resolve a relative SQLite path anchored to
  their own module's location (not `process.cwd()`) — this was a deliberate fix
  for a real divergence bug found during implementation, so the CLI
  (`prisma generate`/`db push`) and the running app always agree on the same
  physical file regardless of the directory a command is invoked from.
  Regenerate the client after schema changes: `npx prisma generate` (run from
  `backend/`).
- **Config**: `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true, ... })` in
  `app.module.ts`), loading `src/config/configuration.ts` and validating through
  `src/config/environment.validation.ts`.
- **Cross-cutting**: the HTTP pipeline lives in `src/app.setup.ts`
  (`configureApp(app)`), shared by `main.ts` and the e2e suite so tests run the same
  stack: `helmet()`, `cookie-parser`, CORS restricted to `FRONTEND_ORIGIN` with
  `credentials: true`, a global `ValidationPipe` (`whitelist: true, transform: true`, no implicit conversion — a wrong JSON type is a 400; numeric query params declare `@Type(() => Number)`),
  and a single global `AllExceptionsFilter` (`src/common/filters/`) that normalizes
  every error response to `{ statusCode, message, timestamp, path }`.
- **Response serialization**: a global `ResponseSerializerInterceptor`
  (`src/common/interceptors/`, in `configureApp`) emits only `@Expose()`d fields of the
  response DTO each handler declares via `@SerializeOptions({ type: XResponseDto })`
  (e.g. `UserResponseDto`); a body without a declared DTO is a 500 (fails closed). Never
  return Prisma models. 204 endpoints return no body.
- **Auth** (`src/auth/`, users in `src/modules/users/`) — email + password, server-side
  sessions in an httpOnly `sid` cookie:
  - `POST /auth/sign-up` `{ email, username, displayName, password }` → 201 + cookie, `{ id,
    email, username, displayName }` (409 `Email is already registered` / `Username is already
    taken`; 400 on an invalid/reserved username, a missing/blank/invalid `displayName` — see
    Profiles below; password 12–128 chars).
  - `POST /auth/sign-in` `{ email, password }` → 200 + cookie, `{ id, email, username,
    displayName }`; generic 401 `Invalid email or password` otherwise.
  - `POST /auth/sign-out` → 204, revokes the session and clears the cookie (idempotent).
  - `GET /auth/me` → `{ id, email, username, displayName }` or 401 (`displayName` is `null` for
    accounts created before display names existed).
  - **Every other endpoint requires a valid `sid` cookie** — a global
    `AuthGuard` (`APP_GUARD`); opt a route out with `@Public()`. POST/PUT/PATCH/DELETE with
    an `Origin` other than `FRONTEND_ORIGIN` get 403, public routes included.
  - Sign-up and sign-in are rate limited to 5 requests/minute per IP (429 beyond).
  - **After pulling this change, run `npx prisma db push` from `backend/`** to create the
    `User`/`Session` tables (and `npx prisma generate` if the client is stale).
- **Profiles** (`src/modules/users/`, `users.controller.ts`) — both routes session-gated:
  - `GET /users/:username` → `{ username, displayName, bio, createdAt, postCount, followerCount,
    followingCount, isFollowing, followsYou }` (case-insensitive lookup; never the email or id) or
    404 `User not found`. `isFollowing` = you follow them, `followsYou` = they follow you — both
    `false` on your own profile.
  - `PATCH /users/me` `{ username?, bio?, displayName? }` → the caller's own `{ id, email,
    username, displayName, bio, createdAt, postCount, followerCount, followingCount }`; 409
    `Username is already taken`, 400 on invalid input. The target is always the session user;
    unknown fields are stripped. Follows key on the user id, so a username change keeps them.
  - **Username:** trimmed + lowercased, 3–20 chars of `a-z0-9_`, not a reserved word (`me`,
    `settings`, `auth`, `users`, `u`, `api`, `admin`, …), unique (any case).
  - **Bio:** optional, trimmed, max 160 chars; an empty string clears it (`null`).
  - **Display name** (`displayName`, shown next to the `@username`): trimmed, then 1–50
    characters counted as Unicode code points (an emoji counts 1), no line breaks; not unique, any
    case kept. **Required at sign-up** (missing/blank → 400). `PATCH /users/me` sets or changes it
    (omitted = unchanged) but **can't clear it**: `''`, whitespace-only or `null` → 400, so once
    set it stays set. Accounts created before display names existed have `displayName: null` (no
    backfill) until they set one in Edit profile.
  - `src/modules/users/username.rules.ts` is authoritative (username, bio and display name); the
    frontend copy in `frontend/src/lib/validation/profile-schemas.js` (incl. `RESERVED_USERNAMES`)
    must match.
  - **After pulling this change, run `npx prisma db push --force-reset` from `backend/`.** It
    **wipes the dev DB** (the new required `username` column can't be added to existing rows) —
    re-create your accounts afterwards.
- **Posts, likes, comments** (`src/modules/posts/`; a user's posts in `src/modules/users/`) — every
  route session-gated (401 without a session; writes with a foreign `Origin` → 403); author/viewer
  ids come only from the session. `Post` = `{ id, body, createdAt, author: { username,
  displayName }, likeCount, commentCount, likedByMe }`, `Comment` = `{ id, body, createdAt,
  author: { username, displayName } }` (`displayName` may be `null`), a page = `{ items,
  nextCursor }` (`nextCursor` null on the last page):

  | Method + path | Result | Errors |
  |---|---|---|
  | `POST /posts` `{ body }` | 201 `Post` | 400 body, 429 (10/min) |
  | `GET /posts/:id` | 200 `Post` | 404 `Post not found` |
  | `DELETE /posts/:id` | 204 (its likes + comments cascade) | 403 not yours, 404 |
  | `GET /feed?cursor=&limit=` | 200 page of `Post`, newest first — **Following**: you + users you follow | 400 bad cursor/limit |
  | `GET /feed/for-you?cursor=&limit=` | 200 page of `Post`, newest first — **For you**: every user's posts | 400 bad cursor/limit |
  | `GET /users/:username/posts?cursor=&limit=` | 200 page of `Post`, newest first | 404 `User not found`, 400 |
  | `PUT /posts/:id/like` | 200 `{ liked: true, likeCount }` (idempotent) | 404 |
  | `DELETE /posts/:id/like` | 200 `{ liked: false, likeCount }` (idempotent) | 404 |
  | `GET /posts/:id/comments?cursor=&limit=` | 200 page of `Comment`, oldest first | 404, 400 |
  | `POST /posts/:id/comments` `{ body }` | 201 `Comment` | 400 body, 404, 429 (20/min) |
  | `DELETE /posts/:id/comments/:commentId` | 204 | 403 not yours, 404 (missing or on another post) |

  `GET /users/:username` and `PATCH /users/me` also return `postCount`.
  - **Feeds** — `GET /feed` (Following) = your posts + posts of users you follow; `GET /feed/for-you`
    (For you) = everyone's posts, no follows needed. Same `Post` shape, paging and `likedByMe` (yours)
    for both.
  - **Body** (posts and comments): trimmed, then 1–280 characters counted as Unicode code points
    (an emoji counts 1); blank is 400. `src/modules/posts/posts.rules.ts` is authoritative; the
    frontend counter (`frontend/src/lib/text.js`) counts the same way.
  - **Paging:** opaque `cursor` (pass back the previous page's `nextCursor`), page size 20 by
    default, `limit` 1–50. An empty `cursor=` is a 400 `Invalid cursor` — omit the param for the
    first page.
  - **Rate limits** (429 `Too many requests, please try again later`, rejected 400s count too):
    create post 10/min and create comment 20/min per signed-in user; sign-in / sign-up 5/min per IP
    (per route); follow / unfollow 30/min (see Follows). Likes aren't limited.
  - **After pulling this change, run `npx prisma db push` from `backend/`** (plain — the new
    tables are additive, no reset) and `npx prisma generate` if the client is stale.
- **Follows** (`src/modules/follows/`, routes under `/users` beside `UsersController`) — every route
  session-gated (401 without a session; writes with a foreign `Origin` → 403); the follower is
  always the session user. Usernames in the path are case-insensitive. `FollowUser` = `{ username,
  displayName, bio, isFollowing, followsYou }` (`displayName` may be `null`; the booleans are
  relative to you, both `false` on your own row; never an id or email):

  | Method + path | Result | Errors |
  |---|---|---|
  | `PUT /users/:username/follow` | 200 `{ following: true, followerCount }` (idempotent) | 400 yourself, 404 `User not found`, 429 (30/min) |
  | `DELETE /users/:username/follow` | 200 `{ following: false, followerCount }` (idempotent) | 400 yourself, 404, 429 (30/min) |
  | `GET /users/:username/followers?cursor=&limit=` | 200 page of `FollowUser`, most recent follow first | 404, 400 bad cursor/limit |
  | `GET /users/:username/following?cursor=&limit=` | 200 page of `FollowUser`, most recent follow first | 404, 400 |
  | `GET /users/me/suggestions?limit=` | 200 `{ items: FollowUser[] }` — users you don't follow, never you, newest accounts first | 400 `limit` outside 1–10 |

  - `followerCount` in the follow / unfollow response is the target's new total.
  - Lists page exactly like the posts listings (opaque `cursor`, `limit` 1–50, default 20, an empty
    `cursor=` → 400). `/users/me/followers` / `following` are a 404 (`me` is a reserved username,
    not an alias — which is also why `/users/me/suggestions` can't clash with a real user).
  - Suggestions: `limit` 1–10, default 3; no ranking beyond newest accounts first.
  - **Rate limit:** `PUT` and `DELETE` get 30/min **each** per signed-in user
    (`FOLLOW_LIMIT_PER_MINUTE`, a constant in `follows.controller.ts` — not an env var); other users
    are unaffected. The lists and suggestions aren't limited.
  - **After pulling this change, run `npx prisma db push` from `backend/`** (plain — `Follow` is a
    new table, no reset) and `npx prisma generate` if the client is stale.
- **Search** (`src/modules/users/search.controller.ts`, in the users module) — session-gated (401
  without a session). Finds users by username **or** display name:

  | Method + path | Result | Errors |
  |---|---|---|
  | `GET /search/users?q=&cursor=&limit=` | 200 page of `FollowUser`, ordered by username | 400 bad `q` / cursor / limit |

  - **`q`:** trimmed, then one leading `@` stripped (`@ada` finds ada), then 1–50 characters
    (code points); missing, empty, blank, `@`-only, over 50 or repeated (`q=a&q=b`) → 400.
  - **Matching:** users whose username or display name **contains** `q`. Case-insensitive for
    ASCII letters only — it's SQLite `LIKE`, which doesn't fold `É`/`é`. `%` and `_` in `q` match
    literally (not as wildcards). No relevance ranking.
  - **You're included** when you match, with `isFollowing` / `followsYou` both `false` on your row.
  - **Paging:** ordered by username ascending, keyset-paged on it (opaque `cursor` — pass back the
    previous page's `nextCursor`; an empty `cursor=` or a cursor from another listing → 400
    `Invalid cursor`); `limit` 1–50, default 20. Not rate limited.
  - The route is `/search/users`, not `/users/search`: `search` isn't a reserved username, so
    `/users/search` would shadow a user called "search".
  - **After pulling this change (it also adds `User.displayName`), run `npx prisma db push` from
    `backend/`** (plain — a new nullable column, no reset; existing users get `null`) and
    `npx prisma generate` if the client is stale.
- **Notifications** (`src/modules/notifications/`) — every route session-gated (401 without a
  session; the POST with a foreign `Origin` → 403) and always the session user's own. Created
  asynchronously from domain events (`src/common/events/`) when someone follows you, likes your
  post or comments on it — never for your own actions. Unlike / unfollow removes the notification;
  deleting the comment, post or either user removes it through the cascade. A failure creating one
  is logged and never fails the like / follow / comment request. `Notification` = `{ id, type
  ('follow' | 'like' | 'comment'), createdAt, read, actor: { username, displayName }, post: { id,
  body } | null, comment: { id, body } | null }`:

  | Method + path | Result | Errors |
  |---|---|---|
  | `GET /notifications?cursor=&limit=` | 200 page of `Notification`, newest first | 400 bad cursor/limit |
  | `GET /notifications/unread-count` | 200 `{ count }` | — |
  | `POST /notifications/read` `{ until }` | 204 — marks your unread notifications created at or before `until` as read | 400 missing / invalid `until` (ISO-8601) |

  - Paging works like the posts listings (opaque `cursor`, `limit` 1–50, default 20, an empty
    `cursor=` → 400). Not rate limited.
  - **After pulling this change, run `npx prisma db push` from `backend/`** (plain — `Notification`
    is a new table, no reset) and `npx prisma generate` if the client is stale.
- **Run**: `start:dev` (watch mode, what `scripts/be-local` uses), `start` (no watch),
  `start:debug`, `start:prod` (runs the compiled `dist/`).
- **Test**: `test` (Vitest unit), `test:watch`, `test:cov` (coverage), `test:debug`,
  `test:e2e` (`vitest.config.e2e.ts`). Unit specs live in a `__tests__/` folder next to the code
  they cover (`src/auth/__tests__/auth.service.spec.ts`); e2e lives in `test/` and runs against its
  own SQLite file, `prisma/e2e.db` (git-ignored), rebuilt from the schema at the start of every run
  and deleted after — it never touches `prisma/dev.db`.
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
- **Test**: `test` (`vitest run`), `test:watch`, `test:cov`. Vitest + jsdom + React
  Testing Library, config in `vite.config.js`'s `test` block. Tests live in a
  `__tests__/` folder next to the code they cover (`src/**/__tests__/*.test.{js,jsx}`). Shared helpers live in `src/test/`: `setup.js`
  (jest-dom matchers, MSW lifecycle), `server.js` (MSW server + default handlers;
  `VITE_API_URL` is pinned to `http://api.test` in tests, build URLs with
  `apiUrl()`), `render.jsx` (`renderWithProviders` — QueryClient from the app's
  `createQueryClient` + `AuthProvider` + MemoryRouter). Unhandled requests fail the
  test. Tests render **signed in** by default (the default MSW `GET /auth/me` handler
  returns a user); override it with a 401 (`server.use(...)`) to render signed out. A default
  `GET /users/:username` handler feeds the shell's profile card (`ada` → bio `null`, others →
  404), and default `GET /feed` / `GET /feed/for-you` / `GET /users/:username/posts` handlers
  return an empty page (`/users/<not ada>/posts` → 404). Follows have defaults too: empty
  suggestions, empty `ada` followers / following (others → 404), and `PUT` / `DELETE
  /users/:username/follow` answering `followerCount` 1 / 0; `GET /search/users` returns no matches
  for any query. Tests routed through `AppRouter` render
  inside the shell, so scope queries with `within(screen.getByRole('main'))`.
- **Structure** (`src/`): `app/` (`App.jsx`, `router.jsx`, `NavigationDepthTracker.jsx`,
  `providers.jsx`, `query-client.js`), `components/ui/` (shadcn), `components/layout/` (app shell),
  `components/feed/` (`Composer`, `PostCard`, `CommentComposer`, `CommentItem`,
  `InfiniteListFooter`, `CharacterCounter`, `PostListSkeleton`), `components/AuthLayout.jsx`,
  `components/BrandMark.jsx`, `components/UserAvatar.jsx`, `components/UserName.jsx`,
  `components/FollowButton.jsx`, `components/FollowListDialog.jsx`, `hooks/`,
  `lib/api/` (HTTP client, `users.js`, `posts.js`, `search.js`, `post-cache.js`,
  `follow-cache.js`, `error-message.js`),
  `lib/text.js`, `lib/format.js`, `lib/composer-focus.js`, `lib/navigation-history.js`,
  `lib/avatar-color.js`,
  `lib/auth/` (`AuthProvider`, `useAuth()`), `lib/validation/` (Zod form schemas),
  `routes/` (`ProtectedRoute`, `PublicOnlyRoute`), `pages/`. `features/` isn't created
  yet — no concrete feature to hang it on.
- **API client** (`src/lib/api/client.js`) — reads `VITE_API_URL` from
  `frontend/.env` (defaults to `http://localhost:3000`; Vite only exposes
  `VITE_`-prefixed vars to client code). Sends `credentials: 'include'` so the
  browser attaches the httpOnly session cookie; no token is ever handled in JS.
- **Auth** — `useAuth()` (`src/lib/auth/use-auth.js`) gives `{ user, isAuthenticated,
  isLoading, isError, isFetching, refetch, signIn, signUp, signOut }`, backed by a
  `GET /auth/me` query. Public routes: `/sign-in`, `/sign-up` (wrapped in
  `PublicOnlyRoute` — signed-in users go back to the originally requested in-app route
  via `src/lib/auth/redirect-target.js`, else `/`) and `/sign-out`; everything else is
  behind `ProtectedRoute` (redirects to `/sign-in`, then back to the requested route
  after signing in). Only a 401 from `/auth/me` means signed out; any other failure
  (500, network) makes `ProtectedRoute` show a "Couldn't reach the server" alert with a
  Retry button instead of redirecting. A 401 from any other
  query/mutation is handled centrally in `src/app/query-client.js` (user reset to
  signed out, other cached queries dropped).
- **TanStack Query** — `QueryClientProvider` (+ `AuthProvider`) lives in
  `src/app/providers.jsx`, wrapping `<App>` in `main.jsx`. React Query Devtools are
  mounted in dev only.
- **Forms** — `react-hook-form` + `zod` (`@hookform/resolvers`), used by the sign-in,
  sign-up and edit-profile pages; schemas in `src/lib/validation/auth-schemas.js` and
  `profile-schemas.js` (username / bio / display-name rules, mirroring the backend).
- **Brand + theme** — the app is "The Flock Twitter" (`index.html` title, feather favicon;
  auth pages set `<page> · The Flock Twitter` via `components/AuthLayout.jsx`). Pulse palette
  tokens (light + dark), `--radius: 1rem`, Geist Sans + Geist Mono (`font-mono` for handles,
  timestamps, small-caps labels) live in `src/index.css`. Dark mode follows the OS (no toggle):
  a custom `dark` variant matches `.dark` or `prefers-color-scheme: dark`. `index.css` also sets
  `scrollbar-gutter: stable` on `html`, so content doesn't shift sideways between pages with and
  without a vertical scrollbar (with a matching override so opening a dialog doesn't shift it
  either).
- **App shell** — every gated page renders inside `components/layout/AppShell.jsx`, a layout
  route (`ProtectedRoute` → `AppShell` → page) in `router.jsx`: left nav rail (`lg`+, labels at
  `xl`), the page in the center column (it renders its own sticky `PageHeader`), right rail
  (`xl`: search, your profile card, who to follow — 366px with 8px inline padding, so the search
  box's focus ring isn't clipped), and a bottom nav + compose button below `lg`. Nav items are
  configured once in `layout/nav-items.js`; Explore is a working item (side and bottom nav).
- **Disabled items** — features without a backend yet are shown but disabled, never with fake
  counts or users. The nav placeholders (Notifications, Messages, Bookmarks), the composer's
  attachment icons and the post cards' Repost / Bookmark / Share are wrapped in
  `layout/ComingSoon.jsx`: `aria-disabled` (not native `disabled`, so the "Coming
  soon" tooltip stays reachable).
- **Display names** — everywhere a user appears (profile header, post cards, comments, follow
  lists, Who to follow, the rail's profile card, search results) `components/UserName.jsx` shows
  the display name in bold followed by the muted `@username`, or just `@username` when the user has
  none. Sign-up has a required **Name** field (1–50, counted like the backend); **Edit profile**
  has a Name field to set or change it — required once set (can't be cleared), may stay empty for
  a user who never set one.
- **Search** — the right rail's search box is a typeahead: after a short pause (250ms) it shows up
  to 5 matching users (by display name or username) in a dropdown; arrow keys + Enter open a user,
  Enter on the query (or "See all results for …") goes to Explore, Escape or clicking away closes
  it. **Explore** (`/explore?q=…`, `pages/Explore.jsx`, in the side and bottom nav — the only way
  to search on phones, where there's no right rail) has its own search box and lists every match,
  ordered by username, with infinite scroll; each row links to the profile and has a Follow /
  Follow back / Following button (none on your own row). The URL follows the box as you type
  (replacing the history entry); states for no query, no results, loading and errors.
- **Who to follow** (`layout/RightRail.jsx`) — up to 3 users you don't follow (newest accounts
  first), each linking to their profile, with a Follow button; skeleton rows while loading; the card
  is hidden when there's nobody to suggest or the request fails. Following someone flips the row to
  "Following" until the suggestions refetch drops it.
- **New post** — the left rail's "New post" and the mobile compose button go to Home and focus
  the composer (on Home they just focus it).
- **Home** (`/`) — two working tabs, **Following** (the default: your posts + people you follow)
  and **For you** (everyone's posts), then the composer and the selected feed, newest first, with
  loading / error + Retry / empty states. The tab lives in the URL: no param = Following,
  `?tab=for-you` = For you (switching replaces the history entry). Following's empty state nudges
  you to follow people (with an "Explore For you" button); the end reads "You're all caught up"
  (Following) / "You've seen every post" (For you). A new post appears at the top of both feeds.
- **Composer** — live `N/280` counter (trimmed body, code points — same as the backend); Post is
  disabled while blank or over 280; Cmd/Ctrl+Enter posts (not during IME composition); the
  textarea is read-only while posting, cleared on success, kept on failure with the server's
  error below (429 → "Too many posts…"). The new post appears at the top of the feed and your
  profile without a reload. The comment composer on the detail page works the same ("Reply");
  if the new reply isn't shown yet (older comments still to load) it says "Reply posted. Load
  more comments to see it."
- **Infinite scroll** — feed, a profile's posts and comments load the next page when the list's
  end gets within 400px of the viewport, with a "Load more" button as the keyboard / fallback
  path and Retry after a failed page.
- **Posts** — each card: avatar + display name and `@username` (→ profile), relative time (the
  link to the post), body as plain text, comments (→ detail), a like toggle (optimistic, rolls back on error), and on
  your own posts a "…" menu → Delete with a confirmation. Clicking the card (not its
  links/buttons) opens the post.
- **Post detail** (`/u/:username/posts/:id`, `pages/PostDetail.jsx`) — the post, a reply box and
  its comments (oldest first, paged; delete your own with a confirmation). A wrong `:username`
  redirects to the author's; an unknown id shows "Post not found". Back returns to the previous
  in-app page, or to the author's profile when there is none (opened directly — redirects don't
  count, so Back never leaves the app); deleting the post goes to the author's profile.
- **Profiles** — `/u/:username` (`pages/Profile.jsx`: Pulse layout — banner, avatar,
  display name (the header title) with `@username` below it, or `@username` alone, the post count,
  bio, join date, "Edit profile" on your own, Posts tab with the
  user's posts, newest first, same paging) and
  `/settings/profile` (`pages/EditProfile.jsx`), both inside the shell. Someone else's profile has
  a Follow / Follow back / Following button (reads "Unfollow" on hover and focus; one click, no
  confirm) and a "Follows you" badge when they follow you; your own has neither. Below "Joined …",
  `N Following  M Followers` — each opens a dialog on that list (tabs to switch, infinite scroll;
  rows link to the profile and carry a follow button, except your own row). Follows are optimistic:
  counts update at once and roll back on error. The nav's Profile item
  and the right rail's card link to your profile. Data via `useProfile(username)`
  (`src/hooks/use-profile.js`, no retry on 404) keyed by `profileQueryKey(username)`
  (`src/lib/api/users.js`, lowercased). The avatar is a placeholder only
  (`components/UserAvatar.jsx`): the username's initial on a colour derived from the username.

---

## Cross-platform

Scripts are `bash`; on Windows run them from **Git Bash** (or WSL). `node` and `npm`
must be on `PATH`.

---
