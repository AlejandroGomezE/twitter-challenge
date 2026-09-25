---
title: Frontend architecture
type: infra
summary: Vite + React SPA (frontend/) structure and current implementation state — TanStack Query, shadcn/ui, react-router, HTTP client, cookie-session auth (useAuth, ProtectedRoute), Pulse theme (tokens, OS dark mode), the app shell layout route with "Coming soon" disabled items, the Home feed page, user profiles (view + edit, avatar placeholder), posts (feed, profile posts, post detail + comments, likes) with infinite queries and race-safe cache updates.
status: active
last-verified: 2026-09-24
tags: [frontend, react, vite, architecture, tanstack-query, shadcn, auth, theme, layout, posts]
---

## Structure

Organize by feature, once there are features to organize:

```text
frontend/src/
├── main.jsx
├── app/
│   ├── App.jsx
│   ├── router.jsx
│   ├── NavigationDepthTracker.jsx # records every navigation for lib/navigation-history.js;
│   │                   #   wraps AppRouter's <Routes>, renders nothing of its own
│   ├── providers.jsx   # QueryClientProvider + AuthProvider (+ devtools in dev)
│   └── query-client.js # createQueryClient() — central 401 handling
├── components/
│   ├── ui/           # shadcn/ui primitives — see [[UI component inventory]]
│   ├── layout/         # the app shell — AppShell, SideNav, MobileNav, RightRail, ComingSoon,
│   │                   #   PageHeader, nav-items.js (see "App shell" below)
│   ├── feed/           # Composer, PostCard, CommentComposer, CommentItem, InfiniteListFooter,
│   │                   #   CharacterCounter, PostListSkeleton (see "Posts" below)
│   ├── AuthLayout.jsx  # frame for /sign-in, /sign-up, /sign-out (brand + document.title)
│   ├── BrandMark.jsx   # the feather logo mark (used by SideNav and AuthLayout)
│   └── UserAvatar.jsx  # avatar placeholder (shadcn Avatar + AvatarFallback)
├── features/           # not created yet
├── hooks/              # use-profile.js — useProfile(username); use-posts.js — useFeed,
│                       #   useUserPosts, usePost, useCreatePost, useDeletePost, useToggleLike;
│                       #   use-comments.js; use-retry-unless-not-found.js; use-open-composer.js
├── lib/
│   ├── api/            # client.js — apiClient, ApiError; users.js — profileQueryKey,
│   │                   #   fetchProfile, updateMyProfile; posts.js — postKeys + post/like/comment
│   │                   #   calls; post-cache.js — cache helpers; error-message.js —
│   │                   #   getApiErrorMessage
│   ├── auth/           # AuthProvider.jsx, use-auth.js, auth-context.js, auth-error-message.js
│   ├── validation/     # auth-schemas.js (sign-in / sign-up), profile-schemas.js (username, bio)
│   ├── avatar-color.js # getAvatarColor / getAvatarInitial for the avatar placeholder
│   ├── text.js         # POST_MAX_LENGTH, measureBody, limitAnnouncement, isSubmitShortcut —
│   │                   #   shared by both composers
│   ├── navigation-history.js # per-entry in-app depth store + useCanGoBackInApp() (Back buttons)
│   ├── format.js       # formatCount ("1.2K"), formatRelativeShort ("3h"), formatFullDate
│   └── composer-focus.js # COMPOSER_TEXTAREA_ID, FOCUS_COMPOSER_STATE, focusComposer()
├── pages/              # Home (feed), SignIn, SignUp, SignOut, Profile, EditProfile, PostDetail
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
  floating "New post" compose button sits bottom-right.
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
- **"New post"** (rail button + mobile compose button) calls `useOpenComposer()`
  (`hooks/use-open-composer.js`): on `/` it focuses the composer at once (`focusComposer()` in
  `lib/composer-focus.js`, by the textarea's `id="composer"`); elsewhere it navigates to `/` with
  `state.focusComposer`, and Home focuses the composer once rendered, then replaces the entry
  with `state: null` so a reload or Back doesn't refocus.
- **Disabled "Coming soon" pattern (`ComingSoon`).** Features we show but don't have yet — the
  disabled nav items, the right rail's search box, Home's "Following" tab, the composer's
  attachment icons and the post cards' Repost / Bookmark / Share — are wrapped in `ComingSoon`: a shadcn `Tooltip` whose `asChild` trigger
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

Centralized `apiClient` (`get` / `post` / `put` / `patch` / `delete`) — no component calls
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
  signOut,          // () → POST /auth/sign-out, then user = null, every other query /
                    //   mutation cleared and like bursts reset (even if the request fails)
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

`src/app/router.jsx` holds the `<Routes>` tree, wrapped in `NavigationDepthTracker` (see
PostDetail's Back rule under Posts) so it sees every navigation, the auth pages' redirects
included:

- `/sign-in`, `/sign-up` — inside `PublicOnlyRoute`: signed-in users go to
  `getRedirectTarget(location.state.from)` (`src/lib/auth/redirect-target.js` — in-app
  paths only; `//host`, `/\host`, non-strings → `/`), else `/`. Because signIn/signUp
  seed `['auth', 'me']`, this is what sends a freshly signed-in user back.
- `/sign-out` — public; the app's single sign-out path (calls `signOut()` once on
  mount, then → `/sign-in`).
- `/` (`Home`, the feed), `/u/:username` (`Profile`), `/u/:username/posts/:id`
  (`PostDetail` — a distinct, longer path, ranked separately from `/u/:username`),
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
  `fetchProfile` (`GET /users/:username` → `{ username, bio, createdAt, postCount }`), keyed by
  `profileQueryKey(username)` = `['users', username.toLowerCase(), 'profile']`
  (`src/lib/api/users.js`) — lowercased so `/u/Ada` and `/u/ada` share one entry. A 404 is
  never retried (`useRetryUnlessNotFound()`, `hooks/use-retry-unless-not-found.js` — shared with
  the post / comment queries); other failures use the QueryClient's default retry.
- **`/u/:username`** (`Profile.jsx`) — Pulse's profile layout: a `PageHeader` with a back
  button (→ `/`) and the mono `@username` as the `h1`, a `bg-primary/10` banner, the large
  avatar overlapping it, an "Edit profile" link (→ `/settings/profile`) only when the username
  matches `useAuth().user.username` (case-insensitive), the mono `@username` again as the name
  line, the bio as plain text with line breaks kept (or "No bio yet."), "Joined <Month yyyy>"
  with a calendar icon, the header subtitle "N posts" (`postCount`, `formatCount`), and a single
  "Posts" tab (tab semantics, no switching) listing the user's posts via `useUserPosts(username)`
  — `PostCard`s, `InfiniteListFooter` ("That's all of @x's posts" at the end), skeleton / error +
  Retry states, and an empty state worded for your own profile or someone else's. The loading
  (skeleton), 404 (shadcn `Empty` "User not found" + "Back to
  home") and error (`Alert` + Retry) states keep the header, titled "Profile". Only data we
  have is shown — no display name, location, website or follower counts.
- **`/settings/profile`** (`EditProfile.jsx`) — inside the shell under a `PageHeader` "Edit
  profile" with a back button (→ your profile); loads the current bio via
  `useProfile(user.username)` (the `me` payload has no bio), then a react-hook-form + zod
  form with a trimmed-length `n/160` bio counter. Only changed fields are sent to
  `updateMyProfile` (`PATCH /users/me`); nothing changed → straight back to the profile. On
  success it seeds `profileQueryKey(<new username>)`, sets `['auth', 'me']` to
  `{ id, email, username }`, removes the old username's profile entry if it changed, and
  navigates (`replace`) to `/u/<new username>` — no stale username left in the cache. The
  PATCH response carries `postCount` too.
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

- **Home (`/`) is the feed.** `PageHeader` "Home" with "For you" / "Following" tabs, then the
  `Composer` and the feed inside the `tabpanel`. The tabs are plain markup with real tab
  semantics (`role="tablist"` / `tab` / `tabpanel`, `aria-selected`, `aria-controls`) and no
  switching — only "For you" exists; "Following" is a `ComingSoon` placeholder. shadcn `Tabs`
  isn't used because Radix triggers activate on focus/mousedown, which `ComingSoon` can't block
  without making the tooltip unreachable. The feed (`useFeed()`): `PostListSkeleton` while
  loading, an `Alert` + Retry on a first-load error, a "No posts yet" empty state, else
  `PostCard`s newest first + `InfiniteListFooter` ("You're all caught up" at the end).
- **Profile / EditProfile** — see Profiles above.
- **PostDetail** — see Posts below.
- **Auth pages** (`SignIn`, `SignUp`, `SignOut`) render outside the shell inside `AuthLayout`:
  centred on the page background, `BrandMark` + "The Flock Twitter" above the content (a
  `rounded-2xl` card), and `document.title` set to `<title> · The Flock Twitter` while mounted
  (the previous title restored on unmount). Their behaviour is unchanged.

## Posts

**Data layer** (`lib/api/posts.js`, `lib/api/post-cache.js`, `hooks/use-posts.js`,
`hooks/use-comments.js`).

- **Keys.** `postKeys`: `all` `['posts']`; every list under `lists()` `['posts', 'list']` —
  `feed()` and `userPosts(username)` (lowercased, like `profileQueryKey`); `detail(id)`;
  `comments(id)`. One prefix reaches every list a post can be in.
- **Queries.** `useFeed()`, `useUserPosts(username)` and `useComments(postId)` are
  `useInfiniteQuery`s (`initialPageParam: null`, `getNextPageParam` = `nextCursor ?? undefined`);
  `usePost(id)` is a `useQuery`. The API functions only append `?cursor=` when there is one — the
  backend rejects an empty `cursor=` with 400. Lookups that can 404 use `useRetryUnlessNotFound()`.
- **`post-cache.js` is the single place for "update a post everywhere it's cached"** (every list
  + its detail): `updatePostInCaches`, `removePostFromCaches` (also drops its detail and comments
  entries), `prependPostToList` (only into a loaded list, skipped if already there),
  `bumpProfilePostCount`, `bumpCommentCount`, `setLikeInCaches`, `findPostInCaches`. Helpers
  return the previous object when nothing changed, so unrelated observers don't re-render.
- **Writes land in the cache, not through invalidation.** Create post → detail seeded, prepended
  to the feed's and the author's first page, profile `postCount` +1. Delete post → removed
  everywhere, `postCount` −1. Create comment → appended to the comments cache **only when every
  page is loaded** (oldest first — otherwise it would sit above comments a later "load more"
  brings in, then show twice), `commentCount` +1; delete comment → removed, −1.
- **Races with in-flight fetches.** A fetch that started before the server applied a write can
  land after the cache write and silently undo it (a new post vanishes, a deleted one comes back,
  a like flips back). So every write after a server change goes through
  `writeAfterServerChange(queryClient, filters, write)`: cancel every in-flight fetch of the
  touched queries (a cancelled fetch reverts to its previous data), `write()`, then restart the
  cancelled **first** loads (queries with no data — cancelling one would leave it pending with
  nothing fetching). Before an optimistic write, `cancelLoadedFetches` cancels only fetches of
  queries that already have data. Trade-off: an in-flight "load more" is cancelled too and is
  re-requested on the next scroll / click.
- **Likes** (`useToggleLike`, `mutate({ postId, liked })` with the intended final state; PUT or
  DELETE — idempotent). Optimistic: cancel loaded fetches, flip `likedByMe` / `likeCount`
  everywhere. Overlapping requests for a post form a **burst** (per QueryClient, a `WeakMap` →
  `Map` by post id) that tracks the last **server-confirmed** state by click order — the cached
  state when the burst began, replaced by each successful response newer than the one it holds.
  When the burst's last request settles, the caches get that confirmed state (through
  `writeAfterServerChange`), so any mix of failures and out-of-order responses ends matching the
  server; if nothing was cached and nothing succeeded, the post is invalidated instead.
  `resetLikeBursts(queryClient)` runs on sign-out (`AuthProvider`), so a like still in flight
  can't write into the next user's cache.

**`InfiniteListFooter`** (`components/feed/`, used by the feed, profile posts and comments —
pass the `useInfiniteQuery` result as `query`). While there are more pages it renders an
IntersectionObserver sentinel (`rootMargin` 400px below the viewport; skipped where IO doesn't
exist) plus one "Load more" button — the keyboard / screen-reader path and the no-IO fallback —
that shows "Loading…" (`aria-disabled`, keeps focus) and becomes Retry with an error `Alert` after
a failed page (a failed page is only re-requested through Retry). At the end: `endMessage`.
Re-arm logic: the observer is armed only while the query isn't fetching at all (a window-focus
refetch or a post-write restart included) and calls `fetchNextPage({ cancelRefetch: false })`
(joins a fetch in flight, never restarts it); when it fires it unobserves, and re-observes once
that `fetchNextPage` resolves — re-observing reports the current intersection, so a sentinel
still in view loads the next page. Without that, a sentinel that fired while a refetch was
starting would only join the refetch and never load page 2 (a refetch that starts and ends between
renders never flips `isFetching` as React sees it). A short page keeps loading until the list
fills the viewport, stopping at the last page or a failed one.

**Composers** (`Composer` on Home, `CommentComposer` on the detail page) share `lib/text.js`
and `CharacterCounter`: `measureBody(body)` gives the trimmed body, its code-point length,
`remaining` and `isValid` (not blank, ≤ 280) — the backend's count. No `maxLength` (it counts
UTF-16), so over-limit text stays visible; the counter turns destructive over 280 and its sr-only
live region only speaks from 20 left (`limitAnnouncement`). Submit is disabled while invalid or
pending; `isSubmitShortcut` = Cmd/Ctrl+Enter, ignored during IME composition. While sending the
textarea is `readOnly` (not `disabled`, so it keeps focus); cleared on success, kept on failure
with `getApiErrorMessage(error, { rateLimitMessage })` below it ("Too many posts…" / "Too many
comments…"; editing dismisses it). `getApiErrorMessage` joins Nest's validation-message arrays.
When a reply is posted but the comments list isn't fully loaded (so it wasn't appended — see the
data layer), `CommentComposer` shows a `role="status"` notice "Reply posted. Load more comments to
see it.", cleared on typing or the next submit.

**`PostCard`** (`variant="card"` default, `"detail"` on the detail page). Avatar + mono
`@username` (→ profile), relative time, the body as a plain text node (`whitespace-pre-wrap`,
never HTML), an action row: comments (a link → detail with the count), like toggle
(`aria-pressed`, `formatCount`), Repost / Bookmark / Share as `ComingSoon`. **Keyboard "open
post" = the timestamp link** (`aria-label` "Open post by @x, <full date>") — one tab stop, no
interactive element nested in another. The **card click is a mouse shortcut** on top: it ignores
non-primary / modified clicks, clicks on inner links / buttons / menu items, clicks from portaled
menus or dialogs, and clicks that end a text selection. Your own posts get a "More options" (…)
`DropdownMenu` (non-modal) → Delete → `AlertDialog` that stays open while the request runs and
shows its error; others' posts have no menu (the API would 403 anyway). `CommentItem` follows the
same layout and own-comment menu.

**PostDetail** (`/u/:username/posts/:id`) loads by id (`usePost`). Once loaded, a `:username`
that isn't the author's (case-insensitive) is a `<Navigate replace>` (no state) to the canonical
URL; 404 → `Empty` "Post not found" + "Back to home"; other errors → `Alert` + Retry. **Back
rule:** Back is `navigate(-1)` only when an in-app entry is behind this one
(`useCanGoBackInApp()(location.key)`), else it goes to the author's profile — so a redirect
(sign-in's return, the canonical redirect) never makes Back leave the app. The depth comes from
`lib/navigation-history.js`: a store that records, per `location.key`, how many app entries
precede it — PUSH = previous + 1, REPLACE = same as previous, POP keeps the recorded value, an
unknown key (first entry, anything from before a reload) = 0. `NavigationDepthTracker`
(`app/`, at the top of `AppRouter`) feeds it from `useLocation` / `useNavigationType` in an
effect; without a tracker (a page rendered alone in a test) the answer is false. Deleting the
post replaces the entry with the author's profile. Below the post: `CommentComposer`, then the comments (oldest first,
`InfiniteListFooter`); after deleting a comment focus moves to the reply box once the comment has
left the list.

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
- Home and the profile page load posts, so `server.js` also has default `GET /feed` (empty page
  `{ items: [], nextCursor: null }`) and `GET /users/:username/posts` (`ada` → empty page,
  others → 404) handlers.
- jsdom has no `IntersectionObserver`, so `InfiniteListFooter` skips auto-loading there and tests
  use "Load more". To test the observer, `vi.stubGlobal('IntersectionObserver', …)` with a small
  fake class (always in view, or controllable) and `vi.unstubAllGlobals()` in `afterEach` — see
  `components/feed/__tests__/InfiniteListFooter.test.jsx`.
- Race tests hold a response with a **gated handler**: `hooks/__tests__/use-posts.test.jsx` has
  a local `gate()` helper returning `{ promise, open }`; the MSW handler does
  `await g.promise` and the test calls `g.open()` when it wants the response to land, so a stale
  refetch or a like request can be made to arrive before / after a cache write.
- Rendering a `ComingSoon` item outside the shell (e.g. `Home` on its own) needs a
  `TooltipProvider` wrapper.
- jsdom has no `ResizeObserver`, so Radix tooltips can't open: assert `aria-disabled` and
  inertness rather than the tooltip text, and use `fireEvent` (no focus/pointer move) where a
  `userEvent` interaction would try to open one.

## Current state vs. this doc

**Implemented:** `app/` (`App.jsx`, `router.jsx` with the `AppShell` layout route,
`NavigationDepthTracker.jsx`, `providers.jsx`, `query-client.js`), the Pulse theme (`index.css`, `index.html`),
`components/ui/` (shadcn, see [[UI component inventory]]), `components/layout/` (the app
shell), `components/feed/` (posts, comments, composers, infinite lists),
`components/AuthLayout.jsx`, `components/BrandMark.jsx`, `components/UserAvatar.jsx`, `hooks/`,
`lib/api/` (`client.js`, `users.js`, `posts.js`, `post-cache.js`, `error-message.js`),
`lib/auth/`, `lib/validation/`, `lib/text.js`, `lib/format.js`, `lib/composer-focus.js`,
`lib/navigation-history.js`,
`lib/avatar-color.js`, `lib/utils.js`, `routes/` (`ProtectedRoute`, `PublicOnlyRoute`), `test/`
(Vitest + RTL + MSW helpers), and `pages/` — `SignIn`, `SignUp`, `SignOut`, `Home` (the feed),
`Profile`, `EditProfile` and `PostDetail`.

**Pending:** follows (next feature) — add followed users to the feed's author set (backend),
enable the Following tab and "Who to follow". Repost, bookmark and share on post cards,
Explore/search, Notifications, Messages and Bookmarks stay "Coming soon" until their features
exist.

**Not implemented, intentionally:** `features/` (profiles and the shell live in the flat
`pages/` / `components/` / `hooks/` / `lib/` layout). It follows once a feature needs it —
see [[Code quality]] for the shape to build it in.
