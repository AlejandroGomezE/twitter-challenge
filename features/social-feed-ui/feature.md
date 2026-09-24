---
slug: social-feed-ui
status: verifying
scope: frontend
next: /close-feature social-feed-ui
---
# Social feed UI (migrated from the "Pulse" prototype, branded "The Flock Twitter")

Source: `temp/social-media-feed/` — a v0-generated Next.js + TypeScript prototype ("Pulse") with a
home feed and a profile page, all local mock state. Keep its **general structure and styling**;
rebuild it with our tools (Vite + React JSX, react-router, TanStack Query, shadcn primitives,
`cn`, lucide-react, `UserAvatar`). None of its mock functionality is migrated.

## Plan
- Touched surface (frontend only):
  - `frontend/src/index.css` — Pulse's design tokens replace our neutral shadcn defaults: warm
    off-white background, coral `primary` (`oklch(0.585 0.196 30)`), warm borders/muted, chart
    colours used for accents, `--radius: 1rem`, a `font-mono` token (Geist Mono via
    `@fontsource-variable/geist-mono`), and the dark palette (applied under
    `prefers-color-scheme: dark` and `.dark`, same as the source).
  - `frontend/index.html` — title "The Flock Twitter", feather favicon, `color-scheme` meta.
  - New app shell (a layout route wrapping every gated page): `components/layout/AppShell.jsx`,
    `SideNav.jsx`, `MobileNav.jsx`, `RightRail.jsx`, plus a shared nav-items list.
  - `pages/Home.jsx` becomes the feed page; `pages/Profile.jsx` and `pages/EditProfile.jsx` restyled
    inside the shell; `pages/SignIn.jsx`, `SignUp.jsx`, `SignOut.jsx` restyled with the brand
    (outside the shell); `app/router.jsx` (layout route); `components/UserAvatar.jsx` palette/typography.
  - `.gitignore` — ignore `temp/` so the prototype is never committed.
  - Docs: `knowledge/infra/frontend-architecture.md`, `knowledge/infra/ui-component-inventory.md`,
    `Runbook.md` (frontend section).
- Layout (from the source): max-width ~1290px, three columns — left rail (icons only at `lg`,
  icons + labels at `xl`), center column (`max-w-[620px]`, `border-x`, sticky blurred header), right
  rail (`xl` only, 350px, cards). Below `lg`: no side rails, a sticky bottom `MobileNav`, and a
  floating compose button.
- Disabled "coming soon" items (Alejandro): Explore, Notifications, Messages, Bookmarks, the search
  box, "Who to follow", the "New post" button, the mobile compose button and the Following tab are
  shown in Pulse's style but **disabled** — `aria-disabled`, not focusable as links, a "Coming soon"
  tooltip (shadcn `Tooltip`), no fake badge counts, no fake suggested users.
- Working items: Home (`/`), Profile (`/u/<me>`), Settings (`/settings/profile`), Sign out
  (`/sign-out`); the active route is highlighted (NavLink).
- Acceptance criteria:
  1. The whole app uses the Pulse palette, radius and Geist Sans/Mono (handles, timestamps and small
     caps labels in mono), in light and — following the OS setting — dark mode; the tab title is
     "The Flock Twitter".
  2. Every gated page renders inside the app shell: left rail with the feather logo + "The Flock
     Twitter", nav, a disabled "New post" button and a signed-in user chip (avatar, @username) at the
     bottom; right rail with a real "Your profile" card (avatar, @username, bio or "No bio yet.",
     "View profile" link) and a disabled "Who to follow" card; responsive per the layout above.
  3. Working nav items navigate and show the active state; disabled items are visibly muted, can't be
     activated (click/keyboard), expose "Coming soon", and never render fake data.
  4. Home (`/`) is the feed page: sticky "Home" header with For you / Following tabs (Following
     disabled), a composer in Pulse's style (user avatar, textarea, 280 counter, "Post" button) that is
     disabled with "Posting is coming soon", and an empty state ("No posts yet").
  5. `/u/:username` in Pulse's profile layout: sticky header with a back button and @username, a
     primary-tinted banner, the large avatar overlapping it, "Edit profile" (own profile only) →
     `/settings/profile`, bio (plain text, line breaks kept) or "No bio yet.", "Joined <Month YYYY>"
     with the calendar icon, a Posts tab with an empty state. Loading / not-found / error states kept
     and restyled. No location, website or follower counts (we don't have that data).
  6. `/settings/profile` lives inside the shell with a Pulse-style header; all its behaviour is
     unchanged.
  7. `/sign-in`, `/sign-up`, `/sign-out` use the brand (logo + name) and the new palette outside the
     shell; their behaviour is unchanged.
- Must not break: every auth + profile behaviour and its tests (gating, redirects incl. return to the
  requested route, sign-out race fix, sign-up/edit validation, cache updates on rename); existing
  test text/roles the tests rely on (update tests deliberately where the markup changes).

## Tasks
- [x] Theme: port Pulse tokens (light + dark) and radius into `index.css`, add Geist Mono
  (`@fontsource-variable/geist-mono`) + `font-mono`, `index.html` title/favicon/color-scheme,
  ignore `temp/` in `.gitignore`; restyle `UserAvatar` (Pulse's tint palette, mono initial).
- [x] App shell: `AppShell` layout route (`<Outlet />`), `SideNav`, `MobileNav`, `RightRail`,
  shared nav-items config with working vs disabled ("Coming soon") items, mobile compose FAB;
  wire gated routes in `router.jsx` through it.
- [x] Home feed page: header + tabs, disabled composer (visual only, no posting logic), empty state.
- [x] Profile + edit profile: Pulse profile layout on real data; EditProfile inside the shell with the
  new header; keep all states and behaviour.
- [x] Auth pages: brand + palette on sign-in / sign-up / sign-out.
- [x] Docs: frontend architecture (shell, layout route, theme tokens, disabled-item pattern), UI
  component inventory (new layout components), Runbook frontend bullets.

## Decisions
- 2026-09-24 · framed · Feed shows an empty state and a disabled composer until posts exist — no
  mock posts (Alejandro).
- 2026-09-24 · framed · Pulse items without a backing feature are kept but disabled with "Coming
  soon", with no fake counts/users (Alejandro).
- 2026-09-24 · framed · Brand name "The Flock Twitter" (Alejandro); Pulse's feather logo kept, its
  tagline dropped.
- 2026-09-24 · framed · Dark mode follows the OS setting, as in the source; no toggle (Alejandro).
- 2026-09-24 · framed · `PostCard` (and its reply/repost/like/bookmark actions) is NOT migrated
  here: with no posts it would be unused code. It belongs to the posts follow-up.
- 2026-09-24 · framed · The profile shows only data we have (username, bio, join date); Pulse's
  display name, location, website and follower counts are dropped rather than faked. The heading is
  `@username`.
- 2026-09-24 · framed · The new layout components (`AppShell`, `SideNav`, `MobileNav`,
  `RightRail`, `ComingSoon`, `PageHeader`, and the feed `Composer` — all ports of Pulse pieces) are
  bespoke compositions of shadcn primitives migrated at Alejandro's request — that
  request is the sign-off `knowledge/decisions/shadcn-component-preference.md` asks for.
- 2026-09-24 · framed · Next.js-only pieces (`next/font`, `@vercel/analytics`, `'use client'`,
  metadata API) and TypeScript types are not carried over.
- 2026-09-24 · building · Tailwind's `dark` variant now matches `.dark` OR `prefers-color-scheme:
  dark` (without a `.light` ancestor), mirroring the token blocks — the stock `(&:is(.dark *))` would
  have left shadcn's ~40 `dark:` utilities inert under OS dark mode (reviewer catch).
- 2026-09-24 · building · Avatar tints get fixed per-tint text colours (all ≥4.5:1 in both themes)
  instead of Pulse's `text-background`, which was ~2.7:1 on the amber tint.
- 2026-09-24 · building · Auth pages share a new `AuthLayout` (centering + BrandMark + name +
  per-page `document.title`, restored on unmount) and `BrandMark` (also used by SideNav). AuthLayout
  sign-off: **approved by Alejandro** (2026-09-24, at Verify). Close: test its title
  set/restore.
- 2026-09-24 · building · Home tabs use Pulse's markup with real tab semantics instead of shadcn
  `Tabs`: Radix triggers activate on focus/mousedown, which `ComingSoon` can't block for the disabled
  "Following" tab. Close: tidy `Home.test.jsx` (an `async` test with no await; the "Following click"
  test proves little since Home has no tab state).
- 2026-09-24 · building · Sizing a `UserAvatar` = default size + a `size-*` class. Passing
  `size="lg"|"sm"` together with a `size-*` class loses: shadcn Avatar's `data-[size=lg]:size-10`
  (class + attribute) out-ranks the class (reviewer caught a 40px profile avatar; fixed there and in
  RightRail).
- 2026-09-24 · verify · Home's header trailing slot shows "created by Alejandro Gomez" instead of the
  Sparkles icon — Alejandro's own edit after the build commit; kept.

## Follow-ups
- [ ] **Posts (next feature):** create and list posts end to end — `Post` model + `POST /posts`
  (280 chars) + feed/profile listing endpoints (response DTOs, auth-gated, user-scoped writes);
  enable the composer and "New post"/mobile compose buttons; migrate Pulse's `PostCard` (author
  avatar, @username, relative time, body, action row); show posts in the Home feed and on
  `/u/:username`'s Posts tab (with counts in the profile header).
- [ ] Later features behind the disabled items: Explore/search, Notifications, Messages, Bookmarks,
  Who to follow (follows), the Following feed tab, replies/reposts/likes.
- [ ] (open) Bundle size: the shell's Radix tooltip + floating-ui (~45 kB) plus layout code pushed the
  main JS chunk from 491 kB to ~549 kB, past Vite's 500 kB warning. Split by route (e.g. `lazy()`
  the gated app vs the auth pages) or tune `build.chunkSizeWarningLimit` deliberately.
- [ ] (open, minor) Disabled "Coming soon" items only explain themselves via a hover/focus tooltip;
  on touch screens a tap shows nothing (they're just muted). Consider a tap-to-toggle tooltip or a
  visible "Soon" hint on mobile. Also `RightRail.jsx`: the search icon isn't dimmed with its input.
- [ ] (open, dev only) The TanStack Query devtools bubble covers the mobile bottom bar's Sign out
  icon in dev; move it (`buttonPosition`) or hide it on small screens. Not in production builds.

## Log
- 2026-09-24 · framed
- 2026-09-24 · built — Pulse theme (light + OS dark), app shell (side/mobile nav, right rail,
  "Coming soon" items), Home feed (tabs, disabled composer, empty state), Pulse profile + edit
  layouts, branded auth pages, docs. FE 17 suites / 194, build + lint green.
- 2026-09-24 · verified — all 7 acceptance criteria + must-not-break in headless Chrome at 1400 /
  1100 / 390 px, light and OS-dark (37/37); AuthLayout and the Pulse UI approved by Alejandro.
