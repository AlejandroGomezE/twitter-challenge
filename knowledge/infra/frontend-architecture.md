---
title: Frontend architecture
type: infra
summary: Vite + React SPA (frontend/) structure and current implementation state — TanStack Query, shadcn/ui, react-router, HTTP client, cookie-session auth (useAuth, ProtectedRoute), Pulse theme (tokens, OS dark mode), the app shell layout route with "Coming soon" disabled items, the Home feed page, user profiles (view + edit, avatar placeholder).
status: active
last-verified: 2026-09-24
tags: [frontend, react, vite, architecture, tanstack-query, shadcn, auth, theme, layout]
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
│   ├── layout/         # the app shell — AppShell, SideNav, MobileNav, RightRail, ComingSoon,
│   │                   #   PageHeader, nav-items.js (see "App shell" below)
│   ├── feed/           # Composer.jsx — the (disabled) post composer on Home
│   ├── AuthLayout.jsx  # frame for /sign-in, /sign-up, /sign-out (brand + document.title)
│   ├── BrandMark.jsx   # the feather logo mark (used by SideNav and AuthLayout)
│   └── UserAvatar.jsx  # avatar placeholder (shadcn Avatar + AvatarFallback)
├── features/           # not created yet
├── hooks/              # use-profile.js — useProfile(username)
├── lib/
│   ├── api/            # client.js — apiClient, ApiError; users.js — profileQueryKey,
│   │                   #   fetchProfile, updateMyProfile; error-message.js — getApiErrorMessage
│   ├── auth/           # AuthProvider.jsx, use-auth.js, auth-context.js, auth-error-message.js
│   ├── validation/     # auth-schemas.js (sign-in / sign-up), profile-schemas.js (username, bio)
│   └── avatar-color.js # getAvatarColor / getAvatarInitial for the avatar placeholder
├── pages/              # Home (feed), SignIn, SignUp, SignOut, Profile, EditProfile
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

## Theme (`src/index.css`, `index.html`)

The look is ported from the "Pulse" prototype and branded **The Flock Twitter** (`index.html`:
that `<title>`, the feather `favicon.svg`, `<meta name="color-scheme" content="light dark">`).

- **Tokens.** `index.css` replaces shadcn's neutral defaults with Pulse's palette as CSS
  variables: a warm off-white `--background`, coral `--primary` (`oklch(0.585 0.196 30)`), warm
  borders/muted, and `--chart-1…5` carrying Pulse's accent hues (nothing outside
  `components/ui/` uses the chart tokens; the avatar tints in `avatar-color.js` borrow those
  hues as fixed `oklch(...)` values). The dark palette is defined twice with the
  same values — under `.dark`, and under `@media (prefers-color-scheme: dark)` for
  `:root:not(.light)`. `--radius` is `1rem` (the `--radius-*` scale derives from it).
- **Fonts.** Geist Sans (`@fontsource-variable/geist`, `--font-sans`, the default) and Geist
  Mono (`@fontsource-variable/geist-mono`, `--font-mono`). Use `font-mono` for handles
  (`@username`), timestamps/counters and the small-caps rail labels (`font-mono text-xs
  uppercase tracking-[0.18em]`).
- **Dark mode follows the OS** — there's no toggle. The `dark:` variant is a custom
  `@custom-variant dark` that matches a `.dark` ancestor **or** `prefers-color-scheme: dark`
  (unless a `.light` ancestor opts out), mirroring the token blocks. The stock shadcn variant
  (`&:is(.dark *)`) only matches a `.dark` class, so under OS dark mode the tokens would switch
  but the ~40 `dark:` utilities inside the shadcn primitives would stay inert.
- **Avatar tints** (`src/lib/avatar-color.js`) are fixed Pulse colours (primary coral + chart
  hues, plus teal / violet / ochre), not theme tokens, so each carries its own text colour —
  white on the darker tints, a warm near-black on the lighter ones — clearing WCAG AA 4.5:1 in
  both themes (Pulse's `text-background` was ~2.7:1 on the amber tint).

## App shell (`src/components/layout/`)

- **Layout route.** In `router.jsx`, every gated route is nested
  `ProtectedRoute` → `AppShell` → the page (via `<Outlet />`). Auth pages sit outside it.
- **Columns.** `AppShell` centres a `max-w-[1290px]` row of three columns:
  - left rail — a `<header>` (the `banner` landmark) holding `SideNav`; hidden below `lg`,
    88px wide with icons only at `lg`, 275px with icons + labels at `xl`;
  - center — `<main id="main-content">`, `border-x`, `lg:max-w-[620px]`, rendering the page;
  - right rail — `<aside aria-label="Sidebar">` holding `RightRail`, 350px, `xl` only.

  Below `lg` there are no rails: `MobileNav` is a sticky bottom bar inside `<main>`, and a
  floating (disabled) "New post" compose button sits bottom-right.
- **Skip link + tooltips.** The shell renders a "Skip to content" link (visible on focus) to
  `#main-content`, and wraps everything in shadcn's `TooltipProvider`.
- **Pages own their header.** Each page renders `PageHeader` at the top of the center column —
  sticky, blurred (`bg-background/85 backdrop-blur-md`), `border-b`. Props: `title` (rendered
  as the page's `h1`), `subtitle` (small muted mono line), `leading` (e.g. a back button),
  `trailing` (e.g. an icon), `children` (full-width row below the title, e.g. tabs),
  `className`.
- **Nav config (`nav-items.js`)** is the single source for `SideNav` and `MobileNav`. An item
  with a `to` builder is a working route (Home `/`, Profile `/u/<me>` — left out while there's
  no username, Settings `/settings/profile`); an item without one is a disabled placeholder
  (Explore, Notifications, Messages, Bookmarks). `mobile` picks the bottom bar's items (no
  Bookmarks, no Settings); `desktop: false` keeps Sign out out of the rail's nav —
  `getSignOutItem()` hands it to `SideNav`'s footer (under the user chip), while the bottom bar
  shows it as its last icon. Sign out always links to `/sign-out`. Working items are
  `NavLink`s, so the active route is highlighted (`end` on Home).
  `getNavItems(username, { mobile })` resolves the list to
  `{ key, label, icon, to, end, disabled }`.
- **Disabled "Coming soon" pattern (`ComingSoon`).** Features we show but don't have yet — the
  disabled nav items, "New post" (rail + mobile button), the right rail's search box and Home's
  "Following" tab — are wrapped in `ComingSoon`: a shadcn `Tooltip` whose `asChild` trigger
  marks the single child `aria-disabled="true"`, muted (`opacity-50`, `cursor-not-allowed`),
  and calls `preventDefault` on click, with a "Coming soon" tooltip on hover and keyboard
  focus. The child is a `<button type="button">` or a read-only input, never a link, and
  deliberately **not** natively `disabled` — disabled elements get no focus or pointer events,
  so the tooltip would be unreachable. Placeholders never show fake data (no badge counts, no
  suggested users). It needs a `TooltipProvider` above it.
- **Rails.** `SideNav`: `BrandMark` + "The Flock Twitter" (home link), the nav, "New post",
  then the signed-in user chip (`UserAvatar` + mono `@username`) and Sign out. `RightRail`: the
  disabled search box, a "Your profile" card (avatar, `@username`, bio or "No bio yet.", "View
  profile" link) and a "Who to follow" card that only says "Coming soon". The profile card
  reads `useProfile(user.username)`, so it shares the cache entry with `/u/<me>` and
  EditProfile (a skeleton while loading; on an error the bio line is left out).

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
- `/` (`Home`, the feed), `/u/:username` (`Profile`),
  `/settings/profile` (`EditProfile`) and a `*` catch-all (→ `/`) — inside
  `ProtectedRoute` and the `AppShell` layout route: signed-out users
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
- **`/u/:username`** (`Profile.jsx`) — Pulse's profile layout: a `PageHeader` with a back
  button (→ `/`) and the mono `@username` as the `h1`, a `bg-primary/10` banner, the large
  avatar overlapping it, an "Edit profile" link (→ `/settings/profile`) only when the username
  matches `useAuth().user.username` (case-insensitive), the mono `@username` again as the name
  line, the bio as plain text with line breaks kept (or "No bio yet."), "Joined <Month yyyy>"
  with a calendar icon, and a single "Posts" tab (tab semantics, no switching) over a "No posts
  yet" empty state. The loading (skeleton), 404 (shadcn `Empty` "User not found" + "Back to
  home") and error (`Alert` + Retry) states keep the header, titled "Profile". Only data we
  have is shown — no display name, location, website or follower counts.
- **`/settings/profile`** (`EditProfile.jsx`) — inside the shell under a `PageHeader` "Edit
  profile" with a back button (→ your profile); loads the current bio via
  `useProfile(user.username)` (the `me` payload has no bio), then a react-hook-form + zod
  form with a trimmed-length `n/160` bio counter. Only changed fields are sent to
  `updateMyProfile` (`PATCH /users/me`); nothing changed → straight back to the profile. On
  success it seeds `profileQueryKey(<new username>)`, sets `['auth', 'me']` to
  `{ id, email, username }`, removes the old username's profile entry if it changed, and
  navigates (`replace`) to `/u/<new username>` — no stale username left in the cache.
- **Avatar placeholder** — no image upload. `UserAvatar` (`src/components/UserAvatar.jsx`)
  composes shadcn `Avatar` + `AvatarFallback`: the username's first character uppercased in
  `font-mono`, on one of 8 Pulse tint / text-colour pairs (see Theme) picked by a hash of the
  lowercased username (`src/lib/avatar-color.js`), so the same user always gets the same
  colour. The root has
  `role="img"` and `aria-label="@username"`; the letter is `aria-hidden`. **Sizing:** for a
  custom size keep the default `size` and pass a `size-*` class (e.g. `className="size-12"`);
  combined with `size="lg"` / `"sm"`, a `size-*` class loses to shadcn's
  `data-[size=lg]:size-10` / `data-[size=sm]:size-6` (`components/ui/avatar.jsx`).

## Pages

- **Home (`/`) is the feed.** `PageHeader` "Home" (a primary `Sparkles` icon trailing) with
  "For you" / "Following" tabs, then the `Composer` and a "No posts yet" empty state inside the
  `tabpanel`. The tabs are plain markup with real tab semantics (`role="tablist"` / `tab` /
  `tabpanel`, `aria-selected`, `aria-controls`) and no switching — only "For you" exists;
  "Following" is a `ComingSoon` placeholder. shadcn `Tabs` isn't used because Radix triggers
  activate on focus/mousedown, which `ComingSoon` can't block without making the tooltip
  unreachable. The `Composer` (`components/feed/`) is visual only: avatar, a natively disabled
  `Textarea` (280 `maxLength`), a visible "Posting is coming soon" hint (its
  `aria-describedby`), disabled attachment icons, a mono `0/280` counter and a disabled "Post"
  button. No mock posts.
- **Profile / EditProfile** — see Profiles above.
- **Auth pages** (`SignIn`, `SignUp`, `SignOut`) render outside the shell inside `AuthLayout`:
  centred on the page background, `BrandMark` + "The Flock Twitter" above the content (a
  `rounded-2xl` card), and `document.title` set to `<title> · The Flock Twitter` while mounted
  (the previous title restored on unmount). Their behaviour is unchanged.

## Tests

Vitest + jsdom + React Testing Library + MSW (`npm test`; config in `vite.config.js`'s
`test` block). Tests live in a `__tests__/` folder next to the file they cover
(`pages/Home.jsx` → `pages/__tests__/Home.test.jsx`). Render through `renderWithProviders(ui, { route })`
(`src/test/render.jsx` — a fresh `createQueryClient()` with no retries, so the central
401 handling applies, plus `AuthProvider` and a `MemoryRouter`) and fake the backend
with MSW handlers from `src/test/server.js` (`server.use(http.get(apiUrl('/path'), …))`)
— never mock `apiClient` or `fetch`, so the real client (URL building, JSON parsing,
`ApiError`) is exercised. Unhandled requests fail the test. Tests render **signed in**
by default (the default `GET /auth/me` handler returns a user); override it with a 401
to render signed out. `src/components/ui/*` (shadcn) isn't tested. Reference tests:
`src/pages/__tests__/Home.test.jsx`, `src/lib/api/__tests__/client.test.js`.

Shell-related gotchas:

- A test that routes through `AppRouter` renders the page **inside the app shell**, so text
  and roles can appear twice (`@ada` in the rail and on the page, a "Sign out" link in the
  rail and the bottom bar). Scope queries: `within(screen.getByRole('main'))` for the page,
  `within(screen.getByRole('banner'))` for the left rail.
- The right rail fetches the signed-in user's profile, so `server.js` has a default
  `GET /users/:username` handler: `ada` (any case) → `{ username: 'ada', bio: null,
  createdAt }`, anything else → 404 `User not found`. Override it per test as usual.
- Rendering a `ComingSoon` item outside the shell (e.g. `Home` on its own) needs a
  `TooltipProvider` wrapper.
- jsdom has no `ResizeObserver`, so Radix tooltips can't open: assert `aria-disabled` and
  inertness rather than the tooltip text, and use `fireEvent` (no focus/pointer move) where a
  `userEvent` interaction would try to open one.

## Current state vs. this doc

**Implemented:** `app/` (`App.jsx`, `router.jsx` with the `AppShell` layout route,
`providers.jsx`, `query-client.js`), the Pulse theme (`index.css`, `index.html`),
`components/ui/` (shadcn, see [[UI component inventory]]), `components/layout/` (the app
shell), `components/feed/Composer.jsx`, `components/AuthLayout.jsx`,
`components/BrandMark.jsx`, `components/UserAvatar.jsx`, `hooks/`, `lib/api/` (`client.js`,
`users.js`, `error-message.js`), `lib/auth/`, `lib/validation/`, `lib/avatar-color.js`,
`lib/utils.js`, `routes/` (`ProtectedRoute`, `PublicOnlyRoute`), `test/` (Vitest + RTL + MSW
helpers), and `pages/` — `SignIn`, `SignUp`, `SignOut`, `Home` (the feed: tabs, disabled
composer, empty state), `Profile` and `EditProfile`.

**Pending (posts follow-up):** there are no posts yet. The next feature enables the
`Composer` and the "New post" / mobile compose buttons, migrates Pulse's `PostCard`, and lists
posts in the Home feed and on the profile's Posts tab. Explore/search, Notifications,
Messages, Bookmarks, Who to follow and the Following tab stay "Coming soon" until their
features exist.

**Not implemented, intentionally:** `features/` (profiles and the shell live in the flat
`pages/` / `components/` / `hooks/` / `lib/` layout). It follows once a feature needs it —
see [[Code quality]] for the shape to build it in.
