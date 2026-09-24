---
title: UI component inventory
type: infra
summary: Inventory of frontend/src/components/ui — all stock shadcn/ui, installed via `shadcn add --all` — plus the app compositions built on them (UserAvatar, BrandMark, AuthLayout, the app shell in components/layout, the feed Composer). Grounds the shadcn-first convention in knowledge/decisions/shadcn-component-preference.md.
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
  colours). Used by the profile page, the rails and the composer. For a custom size keep the
  default `size` and pass a `size-*` class; with `size="lg"` / `"sm"` a `size-*` class loses to
  the stock `data-[size=lg]:size-10` / `data-[size=sm]:size-6` in `ui/avatar.jsx`.
- `BrandMark.jsx` — `BrandMark({ className, iconClassName })`, the logo: lucide `Feather` in a
  `bg-primary` rounded square, decorative (`aria-hidden`). No shadcn primitive. Used by
  `SideNav` and `AuthLayout`.
- `AuthLayout.jsx` — `AuthLayout({ title, className, children })`, the centred frame for
  `/sign-in`, `/sign-up`, `/sign-out`: `BrandMark` + "The Flock Twitter" above the content, and
  `document.title` = `<title> · The Flock Twitter` while mounted. No shadcn primitive (the pages
  put a `Card` inside it). Signed off by Alejandro (2026-09-24).

The Pulse ports below (`components/layout/`, `components/feed/`) were migrated at Alejandro's
request, which is the sign-off [[Shadcn component preference]] asks for:

- `layout/AppShell.jsx` — the layout route for every gated page: three columns (`SideNav`,
  the page via `<Outlet />`, `RightRail`), `MobileNav` + a floating compose button below `lg`,
  a skip link. Uses `TooltipProvider`, `Button`.
- `layout/SideNav.jsx` — left rail: brand, nav from `nav-items.js`, "New post", user chip,
  Sign out. Uses `Button` (+ `UserAvatar`, `BrandMark`, `ComingSoon`).
- `layout/MobileNav.jsx` — bottom bar below `lg`, icons only, same nav config. No shadcn
  primitive (react-router `NavLink` + `ComingSoon`).
- `layout/RightRail.jsx` — right rail (`xl`): disabled search, "Your profile" card, "Who to
  follow" placeholder. Uses `Input`, `Button`, `Skeleton` (+ `UserAvatar`, `ComingSoon`).
- `layout/ComingSoon.jsx` — `ComingSoon({ children, side })`, the disabled-feature wrapper:
  `aria-disabled` + click `preventDefault` + a "Coming soon" tooltip on one focusable child.
  Uses `Tooltip`, `TooltipTrigger`, `TooltipContent` (needs a `TooltipProvider` above).
- `layout/PageHeader.jsx` — `PageHeader({ title, subtitle, leading, trailing, children,
  className })`, the sticky blurred header each page renders (`title` is the `h1`). No shadcn
  primitive.
- `layout/nav-items.js` — not a component: the nav config (`getNavItems`, `getSignOutItem`)
  shared by `SideNav` and `MobileNav`.
- `feed/Composer.jsx` — the post composer, visual only and disabled until posts exist
  ("Posting is coming soon"). Uses `Textarea`, `Button` (+ `UserAvatar`).

Home's feed tabs and the profile's Posts tab are plain markup with tab semantics, not shadcn
`Tabs` (Radix triggers activate on focus/mousedown, which `ComingSoon` can't block) — see
[[Frontend architecture]] → Pages.

## Shared hooks / utils

- `hooks/use-mobile.js` — `useIsMobile()`, matchMedia 768px breakpoint (stock shadcn
  sidebar-support hook). `eslint` currently flags a `react-hooks/set-state-in-effect`
  warning in this file — it's pre-existing in the shadcn-generated code, not something
  introduced locally. Leave it as shadcn ships it rather than hand-patching vendor
  code; re-check on the next `shadcn add --overwrite` if it matters.
- `lib/utils.js` — `cn()`, the stock shadcn `clsx` + `tailwind-merge` helper.
