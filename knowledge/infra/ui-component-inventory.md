---
title: UI component inventory
type: infra
summary: Inventory of frontend/src/components/ui — all stock shadcn/ui, installed via `shadcn add --all` — plus the app compositions built on them (UserAvatar, UserName, BrandMark, AuthLayout, the app shell in components/layout with the right-rail search typeahead, the feed components — Composer, PostCard, comments, InfiniteListFooter, CharacterCounter, PostListSkeleton; the follow components — FollowButton, FollowListDialog; the Explore page's rows). Grounds the shadcn-first convention in knowledge/decisions/shadcn-component-preference.md.
status: active
last-verified: 2026-09-24
tags: [frontend, shadcn, ui, design-system]
---

# `frontend/src/components/ui` — component inventory

Not a separate package — these are plain files living directly in `frontend/src/`,
imported via the `@/components/ui/*` alias (`frontend/components.json`: style
`radix-nova`, base color `neutral`, CSS-variable theming, `tsx: false` since this is a
JS project, not TypeScript).

All 61 files were installed via `npx shadcn@latest add --all` and are currently
**unmodified stock shadcn/ui** — no custom primitive has been added, and no
twitter-clone-domain widget (a tweet card, a feed list, a compose box, etc.) lives in this
folder; those are compositions outside `ui/` (below). Per [[Shadcn component preference]], default to one of these over
hand-rolling an equivalent; build a new one only when nothing here fits, and it needs
Alejandro's review before being accepted.

## Stock shadcn/ui components

`accordion`, `alert`, `alert-dialog`, `aspect-ratio`, `attachment`, `avatar`, `badge`,
`breadcrumb`, `bubble`, `button`, `button-group`, `calendar` (react-day-picker), `card`,
`carousel` (embla), `chart` (Recharts theming wrapper), `checkbox`, `collapsible`,
`combobox`, `command` (cmdk), `context-menu`, `dialog`, `direction`, `drawer` (vaul),
`dropdown-menu`, `empty`, `field`, `hover-card`, `input`, `input-group`, `input-otp`,
`item`, `kbd`, `label`, `marker`, `menubar`, `message`, `message-scroller`,
`native-select`, `navigation-menu`, `pagination`, `popover`, `progress`,
`questionnaire`, `radio-group`, `resizable`, `scroll-area`, `select`, `separator`,
`sheet`, `sidebar` (stock shadcn app-shell sidebar block), `skeleton`, `slider`,
`sonner` (toasts), `spinner`, `switch`, `table`, `tabs`, `textarea`, `toggle`,
`toggle-group`, `tooltip`.

## Custom-built components

No new primitive. App-level compositions of stock primitives live in
`frontend/src/components/` (outside `ui/`):

- `UserAvatar.jsx` — `UserAvatar({ username, size, className, fallbackClassName })`, the
  avatar placeholder: shadcn `Avatar` + `AvatarFallback` showing the username's initial on
  a colour derived from the username (`lib/avatar-color.js`, Pulse tints with per-tint text
  colours). Used by the profile page, the rails, the composer, post / comment cards and the
  follow lists. For a custom size keep the
  default `size` and pass a `size-*` class; with `size="lg"` / `"sm"` a `size-*` class loses to
  the stock `data-[size=lg]:size-10` / `data-[size=sm]:size-6` in `ui/avatar.jsx`.
- `UserName.jsx` — `UserName({ username, displayName, stacked = false, className, nameClassName,
  usernameClassName, fallbackClassName })`, a user's name line: the display name bold, then the
  muted mono `@username`; without a display name only `@username`, styled by `fallbackClassName`
  so each caller keeps its look. One line (the display name truncates first; `@username` only
  beyond 60% of the line), or `stacked` (`@username` below — the profile header). Plain `<span>`s
  whose text reads "Display Name @username" — the accessible-name convention for profile links
  (see [[Frontend architecture]] → Profiles). Used by the profile header, `PostCard`,
  `CommentItem`, `FollowListDialog` rows, the right rail (profile card, Who to follow, search
  options) and Explore rows. No shadcn primitive (`cn` only). **Signed off by Alejandro
  (2026-09-24).**
- `BrandMark.jsx` — `BrandMark({ className, iconClassName })`, the logo: lucide `Feather` in a
  `bg-primary` rounded square, decorative (`aria-hidden`). No shadcn primitive. Used by
  `SideNav` and `AuthLayout`.
- `AuthLayout.jsx` — `AuthLayout({ title, className, children })`, the centred frame for
  `/sign-in`, `/sign-up`, `/sign-out`: `BrandMark` + "The Flock Twitter" above the content, and
  `document.title` = `<title> · The Flock Twitter` while mounted. No shadcn primitive (the pages
  put a `Card` inside it). Signed off by Alejandro (2026-09-24).

The Pulse ports below (`components/layout/`, `feed/Composer.jsx`) were migrated at Alejandro's
request, which is the sign-off [[Shadcn component preference]] asks for (the posts compositions
after them note their own status):

- `layout/AppShell.jsx` — the layout route for every gated page: three columns (`SideNav`,
  the page via `<Outlet />`, `RightRail` — `w-[366px] px-2`, so the search box's focus ring isn't
  clipped by the rail's `overflow-y-auto`), `MobileNav` + a floating compose button below `lg`,
  a skip link. Uses `TooltipProvider`, `Button`.
- `layout/SideNav.jsx` — left rail: brand, nav from `nav-items.js`, "New post", user chip,
  Sign out. Uses `Button` (+ `UserAvatar`, `BrandMark`, `ComingSoon`).
- `layout/MobileNav.jsx` — bottom bar below `lg`, icons only, same nav config. No shadcn
  primitive (react-router `NavLink` + `ComingSoon`).
- `layout/RightRail.jsx` — right rail (`xl`): the live search typeahead (user-search feature —
  no longer "Coming soon"), "Your profile" card, and the live "Who to follow" card (follow-users
  feature): up to 3 suggestions, each a profile link (avatar, `UserName`, one line of bio) +
  `FollowButton`; 3 skeleton rows while loading; the card isn't rendered on an error or with no
  suggestions. The search box is a hand-rolled WAI-ARIA combobox over a dropdown of up to 5 users
  + "See all results" (→ Explore), with keyboard navigation and Escape / click-away to close — not
  shadcn `Command` / `Combobox` / `Popover`, which filter client-side, pick a value, or fight the
  input over focus (see [[Frontend architecture]] → Search); it was part of the feature plan
  Alejandro framed. Uses `Input`, `Button`, `Skeleton`, `Spinner` (+ `UserAvatar`, `UserName`,
  `FollowButton`).
- `layout/ComingSoon.jsx` — `ComingSoon({ children, side })`, the disabled-feature wrapper:
  `aria-disabled` + click `preventDefault` + a "Coming soon" tooltip on one focusable child.
  Uses `Tooltip`, `TooltipTrigger`, `TooltipContent` (needs a `TooltipProvider` above).
- `layout/PageHeader.jsx` — `PageHeader({ title, subtitle, leading, trailing, children,
  className })`, the sticky blurred header each page renders (`title` is the `h1`). No shadcn
  primitive.
- `layout/nav-items.js` — not a component: the nav config (`getNavItems`, `getSignOutItem`)
  shared by `SideNav` and `MobileNav`. Explore is now enabled (→ `/explore`, side and bottom
  nav); Notifications, Messages and Bookmarks stay `ComingSoon`.
- `feed/Composer.jsx` — the Home post composer, now enabled: auto-growing textarea
  (`id="composer"` for "New post"), `N/280` counter, Post (spinner while sending), server error
  below, Cmd/Ctrl+Enter; attachment icons stay `ComingSoon`. Uses `Textarea`, `Button`,
  `Spinner` (+ `UserAvatar`, `CharacterCounter`, `ComingSoon`).

Posts compositions (`components/feed/`, twitter-posts feature). `PostCard` is the Pulse port
(styling already migrated at Alejandro's request); `CommentComposer`, `CommentItem` and
`InfiniteListFooter` were listed in the feature plan Alejandro framed. Behaviour is in
[[Frontend architecture]] → Posts.

- `feed/PostCard.jsx` — `PostCard({ post, variant = 'card' | 'detail', onDeleted, className })`:
  avatar, `UserName` (→ profile), relative time as the "open post" link, plain-text body, action
  row (comments link, like toggle, Repost / Bookmark / Share `ComingSoon`); the whole card is a
  mouse shortcut to the detail page; own posts get a "…" menu → Delete with confirmation. Uses
  `DropdownMenu`, `AlertDialog`, `Button`, `Spinner` (+ `UserAvatar`, `UserName`, `ComingSoon`).
- `feed/CommentComposer.jsx` — `CommentComposer({ postId, textareaRef })`, the reply box on the
  detail page; same rules as `Composer` ("Reply"). Uses `Textarea`, `Button`, `Spinner`
  (+ `UserAvatar`, `CharacterCounter`).
- `feed/CommentItem.jsx` — `CommentItem({ comment, postId, onDeleted })`: avatar, `UserName`,
  relative time, plain-text body; own comments get a "More options" menu → Delete with
  confirmation. Uses `DropdownMenu`, `AlertDialog`, `Button`, `Spinner` (+ `UserAvatar`,
  `UserName`).
- `feed/InfiniteListFooter.jsx` — `InfiniteListFooter({ query, endMessage, loadMoreLabel,
  errorMessage })`, the footer of a cursor-paged list (feed, profile posts, comments):
  IntersectionObserver auto-load + "Load more" / Loading / Retry button, error, end message. Uses
  `Button`, `Spinner`, `Alert`.
- `feed/CharacterCounter.jsx` — `CharacterCounter({ id, length, remaining })`, the mono
  `length/280` counter shared by both composers (destructive over the limit) plus a polite sr-only
  live region near / over the limit. No shadcn primitive. **Signed off by Alejandro (2026-09-24).**
- `feed/PostListSkeleton.jsx` — `PostListSkeleton({ label, count })`, the loading placeholder for
  post-shaped lists (feed, profile posts, comments): `count` card skeletons + an sr-only status.
  Uses `Skeleton`, `Spinner`. **Signed off by Alejandro (2026-09-24).**

Follow compositions (`components/`, follow-users feature). Both were listed in the feature plan
Alejandro framed; behaviour is in [[Frontend architecture]] → Follows.

- `FollowButton.jsx` — `FollowButton({ username, isFollowing, followsYou = false, className })`,
  the follow toggle (`useToggleFollow`): not following → filled pill "Follow", or "Follow back"
  when `followsYou`; following → outline pill "Following" that reads "Unfollow" (destructive tint)
  while hovered **or focused** — one click unfollows, no confirm dialog. `aria-label` "Follow
  @x" / "Follow back @x" / "Unfollow @x". Stays clickable while a request is in flight (optimistic;
  rapid clicks are handled by the hook). Its click calls `preventDefault` + `stopPropagation`, so
  it can sit inside rows that link to a profile. Used by Profile, `FollowListDialog` and the right
  rail. Uses `Button`. **Signed off by Alejandro (2026-09-24).**
- `FollowListDialog.jsx` — `FollowListDialog({ username, tab, onTabChange, onClose, isOwnProfile
  })`, the profile's follow lists in a modal: `@username` title, Following / Followers tabs, only
  the visible tab fetched; each list shows skeleton rows, an error + Retry, an empty state worded
  for your own profile or someone else's, or rows (avatar, `UserName` link stretched over the row
  that closes the dialog, bio, `FollowButton` except on your own row) + `InfiniteListFooter`.
  Returns focus to the element that opened it (the profile's count button). Uses `Dialog`,
  `Tabs` (`line` variant), `Alert`, `Button`, `Skeleton`, `Spinner` (+ `UserAvatar`, `UserName`,
  `FollowButton`, `InfiniteListFooter`). **Signed off by Alejandro (2026-09-24).**

Explore (`pages/Explore.jsx`, user-search feature, listed in the feature plan Alejandro framed) is
a page, not a component: a `PageHeader` with a search `Input`, then skeleton rows / `Alert` +
Retry / empty states or result rows + `InfiniteListFooter`. Its row (`ExploreRow`, local to the
page) is avatar + stretched `UserName` link + bio + `FollowButton` (none on your own row) —
near-identical to `FollowListDialog`'s row; merging the two into one shared row is a noted
follow-up. Uses `Input`, `Alert`, `Button`, `Skeleton`, `Spinner` (+ `PageHeader`, `UserAvatar`,
`UserName`, `FollowButton`, `InfiniteListFooter`). Behaviour is in [[Frontend architecture]] →
Search.

The profile's "Follows you" label is a stock `Badge` (`secondary`), and its "N Following  M
Followers" row is plain buttons inside `Profile.jsx`, not a component.

Home's feed tabs and the profile's Posts tab are plain markup with tab semantics, not shadcn
`Tabs`. Home's two tabs (Following, the default, and For you) now switch: the selection is URL
state (`?tab=for-you`) and both share one panel (composer + the selected feed), which Radix's
one-panel-per-tab model doesn't fit; activation is manual, with roving arrow-key focus. The
profile's single Posts tab doesn't switch. `FollowListDialog` does use shadcn `Tabs` — each tab
has its own panel there. See [[Frontend architecture]] → Pages.

## Shared hooks / utils

- `hooks/use-mobile.js` — `useIsMobile()`, matchMedia 768px breakpoint (stock shadcn
  sidebar-support hook). `eslint` currently flags a `react-hooks/set-state-in-effect`
  warning in this file — it's pre-existing in the shadcn-generated code, not something
  introduced locally. Leave it as shadcn ships it rather than hand-patching vendor
  code; re-check on the next `shadcn add --overwrite` if it matters.
- `lib/utils.js` — `cn()`, the stock shadcn `clsx` + `tailwind-merge` helper.
- `hooks/use-debounced-value.js` — `useDebouncedValue(value, delayMs)`, the value once it has
  stopped changing for `delayMs` (the search typeahead and Explore's URL sync).
- `lib/text.js` — composer body helpers (`POST_MAX_LENGTH`, `countCodePoints`, `measureBody`,
  `limitAnnouncement`, `isSubmitShortcut`); `lib/format.js` — `formatCount`, `formatRelativeShort`, `formatFullDate`
  (date-fns); `lib/composer-focus.js` — focusing the Home composer from "New post".
- `lib/navigation-history.js` — `useCanGoBackInApp()`, whether `navigate(-1)` stays inside the
  app (used by PostDetail's Back); fed by `app/NavigationDepthTracker.jsx`, a provider at the
  top of `AppRouter` that renders nothing of its own. Not UI.
