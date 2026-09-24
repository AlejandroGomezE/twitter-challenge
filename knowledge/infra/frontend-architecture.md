---
title: Frontend architecture
type: infra
summary: Vite + React SPA (frontend/) structure and current implementation state — TanStack Query, shadcn/ui, react-router, HTTP client, cookie-session auth (useAuth, ProtectedRoute), user profiles (view + edit, avatar placeholder).
status: active
last-verified: 2026-09-24
tags: [frontend, react, vite, architecture, tanstack-query, shadcn, auth]
---

## Structure

Organize by feature, once there are features to organize:

```text
frontend/src/
├── main.jsx
├── app/
│   ├── App.jsx
│   ├── router.jsx
│   ├── providers.jsx   # QueryClientProvider + AuthProvider (+ devtools in dev)
│   └── query-client.js # createQueryClient() — central 401 handling
├── components/
│   ├── ui/           # shadcn/ui primitives — see [[UI component inventory]]
│   ├── UserAvatar.jsx  # avatar placeholder (shadcn Avatar + AvatarFallback)
│   └── layout/        # not created yet — no shared layout shell exists
├── features/           # not created yet
├── hooks/              # use-profile.js — useProfile(username)
├── lib/
│   ├── api/            # client.js — apiClient, ApiError; users.js — profileQueryKey,
│   │                   #   fetchProfile, updateMyProfile; error-message.js — getApiErrorMessage
│   ├── auth/           # AuthProvider.jsx, use-auth.js, auth-context.js, auth-error-message.js
│   ├── validation/     # auth-schemas.js (sign-in / sign-up), profile-schemas.js (username, bio)
│   └── avatar-color.js # getAvatarColor / getAvatarInitial for the avatar placeholder
├── pages/              # Home, SignIn, SignUp, SignOut, Profile, EditProfile
├── routes/             # ProtectedRoute.jsx, PublicOnlyRoute.jsx
└── test/               # shared test helpers — setup.js, server.js (MSW), render.jsx
```

Each feature, once one exists, should follow:

```text
features/<name>/
├── api/
├── components/
├── hooks/
├── schemas/
└── pages/
```

Don't create these folders ahead of a real feature — an empty `features/<name>/` is
dead weight until there's something to put in it.

## HTTP client (`src/lib/api/client.js`)

Centralized `apiClient` (`get` / `post` / `patch` / `delete`) — no component calls
`fetch` directly. It:

- Reads `VITE_API_URL` (`frontend/.env`, defaults to `http://localhost:3000` if unset;
  Vite only exposes `VITE_`-prefixed vars to client code)
- Sets `Content-Type: application/json` and JSON-encodes request bodies
- Parses the response by its actual `content-type` (JSON vs. text) rather than
  assuming JSON
- Throws a single `ApiError` (status + message + body) on a non-2xx response, so every
  caller handles one error shape; an empty body (e.g. 204) resolves to `null`
- Sends `credentials: 'include'` on every request, so the browser attaches the httpOnly
  `sid` session cookie cross-origin (`:5173` → `:3000`). No token is read or attached in
  JS — there's none to read.

## TanStack Query

`QueryClientProvider` lives in `src/app/providers.jsx` (wrapping `AuthProvider`), which
wraps `<BrowserRouter>` + `<App>` in `main.jsx`. React Query Devtools mount in dev only
(`import.meta.env.DEV`). Use it for queries, mutations, cache invalidation,
loading/error states, and retries — don't hand-roll any of that with `useEffect` +
`useState`.

The client comes from `createQueryClient()` (`src/app/query-client.js`), which owns the
**central 401 handling**: a 401 from any query (other than `['auth', 'me']` itself) or
any mutation means the session expired, so it sets the cached user to `null` (which
makes `ProtectedRoute` redirect to `/sign-in`) and removes every other cached query.
401s are never retried; other failures get one retry.

## Auth (`src/lib/auth/`)

Cookie-session auth against the backend's `/auth/*` endpoints (see
[[Backend architecture]]). The session lives in the httpOnly cookie — JS never sees a
token — so the source of truth is `GET /auth/me`, cached under `['auth', 'me']`
(`null` = signed out; a 401 there resolves to `null` rather than erroring). Only a 401
means signed out: any other `/auth/me` failure (500, network) leaves the query in an
error state (`retry: false` — the user retries via the Retry button). A session
survives a reload because the cookie does.

`useAuth()` (`use-auth.js`; throws outside `AuthProvider`) returns:

```js
{
  user,             // { id, email, username } | null
  isAuthenticated,  // Boolean(user)
  isLoading,        // the /auth/me query is still pending
  isError,          // /auth/me failed with a non-401 error and there is no cached user
  isFetching,       // /auth/me is (re)fetching — drives the Retry button's spinner
  refetch,          // () → refetch /auth/me (the Retry button)
  signIn,           // ({ email, password }) → POST /auth/sign-in, seeds ['auth', 'me']
  signUp,           // ({ email, password, username }) → POST /auth/sign-up, seeds ['auth', 'me']
  signOut,          // () → POST /auth/sign-out, then user = null and every other query /
                    //   mutation cleared (even if the request fails)
}
```

`signIn` / `signUp` reject with the `ApiError`; pages turn it into text with
`getAuthErrorMessage()` (`auth-error-message.js`, now a re-export of the generic
`getApiErrorMessage()` in `src/lib/api/error-message.js` — friendlier 429 text, joins Nest
validation message arrays; also used by the edit-profile page). This deliberately differs
from the `getAccessToken()` shape sketched in [[Code quality]]: with an httpOnly cookie
session there's no token for JS to fetch or attach.

## Forms

React Hook Form for form state, Zod for the schema and validation messages,
`zodResolver` from `@hookform/resolvers` to bridge the two. Schemas live in
`src/lib/validation/` — `auth-schemas.js` (`signInSchema`, `signUpSchema` with
`confirmPassword` and `username`) mirrors the backend DTO rules (password 12–128 on
sign-up); `profile-schemas.js` (`usernameSchema`, `bioSchema`, `RESERVED_USERNAMES`)
mirrors `backend/src/modules/users/username.rules.ts` — username trimmed + lowercased,
3–20 chars of `[a-z0-9_]`, not reserved; bio trimmed, max 160 — and its reserved list must
match the backend's. The backend stays the source of truth. Used by `SignIn.jsx`,
`SignUp.jsx` and `EditProfile.jsx`, which show field errors inline and the server error in
a shadcn `Alert`.

## Routes

`src/app/router.jsx` holds the `<Routes>` tree:

- `/sign-in`, `/sign-up` — inside `PublicOnlyRoute`: signed-in users go to
  `getRedirectTarget(location.state.from)` (`src/lib/auth/redirect-target.js` — in-app
  paths only; `//host`, `/\host`, non-strings → `/`), else `/`. Because signIn/signUp
  seed `['auth', 'me']`, this is what sends a freshly signed-in user back.
- `/sign-out` — public; the app's single sign-out path (calls `signOut()` once on
  mount, then → `/sign-in`).
- `/` (`Home`, links to your own profile), `/u/:username` (`Profile`),
  `/settings/profile` (`EditProfile`) and a `*` catch-all (→ `/`) — inside
  `ProtectedRoute`: signed-out users
  go to `/sign-in` with `state.from`, and `PublicOnlyRoute` sends them back there
  afterwards (in-app paths only; `SignIn` also navigates to the same target so it works
  outside the guard).

Both route guards (`src/routes/`) show a spinner while `isLoading`. When `/auth/me`
fails with a non-401 error (`isError`), `ProtectedRoute` shows a centered destructive
`Alert` ("Couldn't reach the server…") with a Retry `Button` (calls `refetch`, spinner
while fetching) instead of redirecting; `PublicOnlyRoute` still renders the
sign-in / sign-up page, whose submit surfaces its own error. See
[[Code quality]]'s routes checklist for what's still to build (404 page, error
boundary).

## Profiles

- **Data.** `useProfile(username)` (`src/hooks/use-profile.js`) is a `useQuery` over
  `fetchProfile` (`GET /users/:username` → `{ username, bio, createdAt }`), keyed by
  `profileQueryKey(username)` = `['users', username.toLowerCase(), 'profile']`
  (`src/lib/api/users.js`) — lowercased so `/u/Ada` and `/u/ada` share one entry. A 404 is
  never retried; other failures use the QueryClient's default retry.
- **`/u/:username`** (`Profile.jsx`) — skeleton while loading, a shadcn `Empty` "User not
  found" on 404, an error `Alert` + Retry otherwise; then avatar, `@username`, bio as plain
  text (or "No bio yet."), "Joined <Month yyyy>", and an "Edit profile" link only when the
  username matches `useAuth().user.username` (case-insensitive).
- **`/settings/profile`** (`EditProfile.jsx`) — loads the current bio via
  `useProfile(user.username)` (the `me` payload has no bio), then a react-hook-form + zod
  form with a trimmed-length `n/160` bio counter. Only changed fields are sent to
  `updateMyProfile` (`PATCH /users/me`); nothing changed → straight back to the profile. On
  success it seeds `profileQueryKey(<new username>)`, sets `['auth', 'me']` to
  `{ id, email, username }`, removes the old username's profile entry if it changed, and
  navigates (`replace`) to `/u/<new username>` — no stale username left in the cache.
- **Avatar placeholder** — no image upload. `UserAvatar` (`src/components/UserAvatar.jsx`)
  composes shadcn `Avatar` + `AvatarFallback`: the username's first character uppercased,
  on one of 8 Tailwind colour pairs picked by a hash of the lowercased username
  (`src/lib/avatar-color.js`), so the same user always gets the same colour. The root has
  `role="img"` and `aria-label="@username"`; the letter is `aria-hidden`.

## Tests

Vitest + jsdom + React Testing Library + MSW (`npm test`; config in `vite.config.js`'s
`test` block). Tests are colocated next to the file they cover (`Home.jsx` →
`Home.test.jsx`). Render through `renderWithProviders(ui, { route })`
(`src/test/render.jsx` — a fresh `createQueryClient()` with no retries, so the central
401 handling applies, plus `AuthProvider` and a `MemoryRouter`) and fake the backend
with MSW handlers from `src/test/server.js` (`server.use(http.get(apiUrl('/path'), …))`)
— never mock `apiClient` or `fetch`, so the real client (URL building, JSON parsing,
`ApiError`) is exercised. Unhandled requests fail the test. Tests render **signed in**
by default (the default `GET /auth/me` handler returns a user); override it with a 401
to render signed out. `src/components/ui/*` (shadcn) isn't tested. Reference tests:
`src/pages/Home.test.jsx`, `src/lib/api/client.test.js`.

## Current state vs. this doc

**Implemented:** `app/` (`App.jsx`, `router.jsx`, `providers.jsx`, `query-client.js`),
`components/ui/` (shadcn, see [[UI component inventory]]), `components/UserAvatar.jsx`,
`hooks/`, `lib/api/` (`client.js`, `users.js`, `error-message.js`), `lib/auth/`,
`lib/validation/`, `lib/avatar-color.js`, `lib/utils.js`, `routes/` (`ProtectedRoute`,
`PublicOnlyRoute`), `test/` (Vitest + RTL + MSW helpers), and `pages/` — `SignIn`,
`SignUp`, `SignOut`, `Home` (shows the signed-in email, a sign-out button and a "View
profile" link), `Profile` and `EditProfile`.

**Not implemented, intentionally:** `components/layout/`, `features/` (profiles live in
the flat `pages/` / `hooks/` / `lib/` layout). These follow once a feature needs them —
see [[Code quality]] for the shape to build them in.
