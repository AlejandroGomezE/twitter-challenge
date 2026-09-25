---
slug: spec-gaps
status: verifying
scope: frontend
next: /review-feature spec-gaps
---
# Spec gaps: tablet layout, browser E2E for auth, Runbook order

Closes three gaps found by checking the repo against the challenge spec: the tablet breakpoint
(640–1024px) has no layout of its own, the auth flow has no browser-driven E2E test, and the Runbook
opens with history instead of setup steps.

## Plan
- Touched surface:
  - `frontend/src/components/layout/AppShell.tsx`, `MobileNav.tsx`, `SideNav.tsx` (comments only if
    needed), and their `__tests__/`.
  - New: `frontend/playwright.config.ts`, `frontend/e2e/auth.spec.ts`, a `test:e2e` script and the
    `@playwright/test` devDependency in `frontend/package.json`, `.gitignore` entries for Playwright
    output and its database file.
  - `Runbook.md` (restructure), `README.md` (Testing section: the new browser E2E + responsive table
    row wording).
- Tablet layout (T1). Today everything switches at `lg` (1024px): below it you get the phone layout
  stretched to full width. New behaviour:
  - **< 640px (mobile):** unchanged — bottom nav, floating compose button, full-width column.
  - **640–1024px (tablet):** the left rail shows **icon-only** (`SideNav` already collapses labels
    below `xl`); bottom nav and floating compose button are hidden; the center column is capped at
    the same `max-w-[620px]` as desktop, and the rail + column are centered as a group (no big empty
    band on one side).
  - **≥ 1024px / ≥ 1280px:** unchanged (icon rail at `lg`, labelled rail + right rail at `xl`).
  - I.e. the `lg:` breakpoints that toggle rail / bottom nav / FAB / column cap move to `sm:`.
- Browser E2E (T2). Playwright, Chromium only, in `frontend/`:
  - `playwright.config.ts` `webServer` starts its **own** backend and frontend on ports that don't
    clash with dev servers (backend `3100`, frontend `5174`), with `DATABASE_URL` pointing at a
    dedicated SQLite file (e.g. `file:./playwright.db`, recreated with `prisma db push
    --force-reset` before each run), `FRONTEND_ORIGIN=http://localhost:5174` and
    `VITE_API_URL=http://localhost:3100`. It never touches `dev.db` or `e2e.db`.
    `reuseExistingServer: false`.
  - `e2e/auth.spec.ts`: sign up a fresh unique user through `/sign-up` → lands on Home with the
    user's handle visible → sign out → redirected to `/sign-in` and a gated URL (`/`) sends you back
    to sign-in → sign in with the same credentials → Home again. Plus one negative case: a wrong
    password shows the "Invalid email or password" error. Stay under the 5/min sign-up/sign-in rate
    limit (one sign-up, at most three sign-ins per run).
  - `npm run test:e2e` in `frontend/` runs it; one-time `npx playwright install chromium`.
  - Vitest only includes `src/**`, so `e2e/` is not picked up by `npm test`.
- Runbook (T3), doc-only:
  - Open with a short intro for evaluators, then **First-time setup** (prerequisites, then the exact
    commands) as the first section, followed by the Quick reference, Environment variables, Run all
    tests (now including the Playwright suite and its one-time browser install), Run with Docker.
  - Remove the "after pulling the X change, run `db push` / `--force-reset`" notes everywhere (the
    Quick reference paragraph and the per-module Backend bullets) — they only matter for databases
    older than this repo's current schema, and a fresh `db push` creates the latest schema.
  - Drop the "Context for Alejandro and AI agents" framing; keep the rest of the reference material.
- Acceptance criteria:
  1. At 768px wide the app shows the icon-only left rail, no bottom nav, no floating compose button,
     and a centered column ≤ 620px; at 375px it looks exactly as before; at 1024px+ it looks exactly
     as before.
  2. `cd frontend && npm run test:e2e` passes on a machine with the backend set up (First-time setup)
     and Chromium installed, without any server already running, and leaves `dev.db` untouched.
  3. The Runbook's first section after the intro is First-time setup; it contains no "after pulling"
     notes; following it top to bottom on a fresh clone gets the app running and all tests (unit,
     backend e2e, Playwright) passing.
  4. `npm test` and `npm run lint`/`typecheck` in `frontend/` still pass.
- Must not break: mobile layout below 640px; the desktop layout; the Docker stack; existing Vitest
  suites (`AppShell.test.tsx` relies on both navs being in the jsdom DOM).

## Tasks
- [x] (T1, fe) Tablet layout: move rail / bottom nav / FAB / column-cap switches from `lg:` to `sm:` in `AppShell.tsx` and `MobileNav.tsx`, center rail + column on tablet, update the layout comments and any tests asserting those classes
- [x] (T2, fe) Playwright auth E2E: add `@playwright/test`, `playwright.config.ts` (own backend on 3100 + Vite on 5174, dedicated `playwright.db` reset per run), `e2e/auth.spec.ts`, `test:e2e` script, `.gitignore` for `test-results/`, `playwright-report/`, `playwright.db*`
- [x] (T3, fe, after: T2) Runbook restructure: evaluator intro, First-time setup first, remove every "after pulling X" note, add the Playwright run + `npx playwright install chromium` to Run all tests and prerequisites; update README Testing section for the browser E2E and the responsive row for the tablet layout

## Decisions
- 2026-09-25 · framed · One feature for the three gaps (all found in the same spec review, all small).
- 2026-09-25 · framed · Tablet switch at `sm` (640px), the spec's own tablet boundary, rather than
  `md` (768px): leaves no 640–768px band that still gets the stretched phone layout.
- 2026-09-25 · framed · Playwright lives in `frontend/` (it drives the UI) and starts its own servers
  on separate ports with a separate SQLite file, so it can't collide with dev servers or dev data.
  Chromium only, to keep the install and run small.
- 2026-09-25 · build (T2) · The Playwright backend resets its database by deleting
  `backend/prisma/playwright.db*` (a `node -e` step) and running a plain `prisma db push`, not
  `db push --force-reset`: Prisma 7 refuses `--force-reset` when it detects an AI agent unless the
  user's consent is passed in an env var. Deleting the dedicated file gives the same empty database,
  never prompts, and runs the same for a human, an agent or CI.

## Follow-ups

## Log
- 2026-09-25 · framed
- 2026-09-25 · built — tablet layout from sm, Playwright auth E2E (2 passed, own servers + playwright.db), Runbook opens with First-time setup and has no "after pulling" notes; frontend build, 52 suites / 606 tests, lint green
