---
slug: social-feed-ui
status: framed
scope: frontend
next: /implement social-feed-ui
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
- [ ] Theme: port Pulse tokens (light + dark) and radius into `index.css`, add Geist Mono
  (`@fontsource-variable/geist-mono`) + `font-mono`, `index.html` title/favicon/color-scheme,
  ignore `temp/` in `.gitignore`; restyle `UserAvatar` (Pulse's tint palette, mono initial).
- [ ] App shell: `AppShell` layout route (`<Outlet />`), `SideNav`, `MobileNav`, `RightRail`,
  shared nav-items config with working vs disabled ("Coming soon") items, mobile compose FAB;
  wire gated routes in `router.jsx` through it.
- [ ] Home feed page: header + tabs, disabled composer (visual only, no posting logic), empty state.
- [ ] Profile + edit profile: Pulse profile layout on real data; EditProfile inside the shell with the
  new header; keep all states and behaviour.
- [ ] Auth pages: brand + palette on sign-in / sign-up / sign-out.
- [ ] Docs: frontend architecture (shell, layout route, theme tokens, disabled-item pattern), UI
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
  `RightRail`) are bespoke compositions of shadcn primitives migrated at Alejandro's request — that
  request is the sign-off `knowledge/decisions/shadcn-component-preference.md` asks for.
- 2026-09-24 · framed · Next.js-only pieces (`next/font`, `@vercel/analytics`, `'use client'`,
  metadata API) and TypeScript types are not carried over.

## Follow-ups
- [ ] **Posts (next feature):** create and list posts end to end — `Post` model + `POST /posts`
  (280 chars) + feed/profile listing endpoints (response DTOs, auth-gated, user-scoped writes);
  enable the composer and "New post"/mobile compose buttons; migrate Pulse's `PostCard` (author
  avatar, @username, relative time, body, action row); show posts in the Home feed and on
  `/u/:username`'s Posts tab (with counts in the profile header).
- [ ] Later features behind the disabled items: Explore/search, Notifications, Messages, Bookmarks,
  Who to follow (follows), the Following feed tab, replies/reposts/likes.

## Log
- 2026-09-24 · framed
