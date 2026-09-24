---
title: UI component inventory
type: infra
summary: Inventory of frontend/src/components/ui — all stock shadcn/ui, installed via `shadcn add --all` — plus the app compositions built on them (UserAvatar). Grounds the shadcn-first convention in knowledge/decisions/shadcn-component-preference.md.
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
twitter-clone-domain widget (a tweet card, a feed list, a compose box, etc.) exists in
this folder yet. Per [[Shadcn component preference]], default to one of these over
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
  a colour derived from the username (`lib/avatar-color.js`). Used by the profile page.

## Shared hooks / utils

- `hooks/use-mobile.js` — `useIsMobile()`, matchMedia 768px breakpoint (stock shadcn
  sidebar-support hook). `eslint` currently flags a `react-hooks/set-state-in-effect`
  warning in this file — it's pre-existing in the shadcn-generated code, not something
  introduced locally. Leave it as shadcn ships it rather than hand-patching vendor
  code; re-check on the next `shadcn add --overwrite` if it matters.
- `lib/utils.js` — `cn()`, the stock shadcn `clsx` + `tailwind-merge` helper.
