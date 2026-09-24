---
slug: user-profile
status: building
scope: full-stack
next: /implement user-profile
---
# Basic user profile (username, bio, avatar placeholder)

## Plan
- Touched surface:
  - `backend/prisma/schema.prisma` — `User` gains `username String @unique` (required, stored
    lowercase) and `bio String?`.
  - `backend/src/modules/users/` — repository/service (username rules, uniqueness, bio update), new
    `users.controller.ts`, request DTOs (`update-profile.dto.ts`), response DTOs
    (`profile-response.dto.ts`; `user-response.dto.ts` gains `username`).
  - `backend/src/auth/` — sign-up DTO + service take `username`.
  - `backend/test/app.e2e-spec.ts`.
  - `frontend/src/pages/SignUp.jsx` (+ `lib/validation/auth-schemas.js`), new
    `pages/Profile.jsx` (`/u/:username`), new `pages/EditProfile.jsx` (`/settings/profile`),
    `app/router.jsx`, `pages/Home.jsx` (link to own profile), shared
    `lib/validation/profile-schemas.js`.
  - Docs: Runbook, backend/frontend architecture knowledge docs.
- API (all gated except where noted, all bodies through response DTOs):
  - `POST /auth/sign-up` (public) body adds `username`; responses of sign-up/sign-in/me become
    `{ id, email, username }`.
  - `GET /users/:username` → 200 `ProfileResponseDto { username, bio, createdAt }` (never email or
    id-internal fields of other users) or 404.
  - `PATCH /users/me` `{ username?, bio? }` → 200 `{ id, email, username, bio, createdAt }` for the
    caller; 409 if the username is taken.
- Rules:
  - **Username:** 3–20 chars, `a-z`, `0-9`, `_` only, trimmed + lowercased before validation/storage,
    unique case-insensitively (enforced by the DB unique index on the lowercased value), and not a
    reserved word (`me`, `settings`, `sign-in`, `sign-up`, `sign-out`, `auth`, `users`, `u`, `api`,
    `admin`, `root`) — shared list between backend validation and frontend schema.
  - **Bio:** optional, trimmed, max 160 chars, plain text (rendered as text, never as HTML); empty
    string clears it (stored as `null`).
  - **Avatar placeholder:** no upload; shadcn `Avatar` with `AvatarFallback` showing the username's
    first character uppercased, on a background colour picked deterministically from the username
    (same user → same colour).
- Acceptance criteria:
  1. Sign-up requires a valid username; a taken username (any case) → 409 `Username is already
     taken`; invalid/reserved → 400. `/auth/me` returns `{ id, email, username }`.
  2. `GET /users/:username` (case-insensitive lookup) returns `{ username, bio, createdAt }` only — no
     email, no passwordHash; unknown → 404; without a session → 401.
  3. `PATCH /users/me` updates bio (≤160, empty clears) and/or username (same rules, 409 on taken);
     it can only ever change the caller's own profile; unknown fields are stripped.
  4. Frontend sign-up form has a username field with the same validation and shows 409/400 errors.
  5. `/u/:username` shows avatar placeholder, `@username`, bio (or an empty-bio hint), join date;
     unknown username → a "User not found" state; loading state while fetching.
  6. On your own profile an "Edit profile" button links to `/settings/profile`; other users' profiles
     don't show it.
  7. `/settings/profile` edits username + bio (160-char counter, client validation mirroring the
     backend), shows server errors, and on save navigates to `/u/<new username>` with the new data
     visible (me + profile caches updated, no stale username anywhere).
  8. Home links to the signed-in user's profile.
- Must not break: sign-in/sign-out/me flows and all auth security behaviour (guard, Origin check,
  throttling, fail-closed serialization); existing backend/frontend test suites (updated where
  sign-up now needs a username).

## Tasks
- [x] Prisma: `username` (unique, required) + `bio` (optional) on `User`; reset the dev DB
  (`npx prisma db push --force-reset`) and `generate`.
- [x] Backend users: username/bio rules (shared reserved list + normalizer), repository methods
  (`findByUsername`, `updateProfile`), service (`getProfile`, `updateProfile`, P2002 on username →
  409), `UserResponseDto` + `username`, new `ProfileResponseDto` / `MyProfileResponseDto`.
- [x] Backend endpoints: `users.controller.ts` — `GET /users/:username`, `PATCH /users/me` (DTO
  validation, `@CurrentUser()`, response DTOs); register in `UsersModule`/`AppModule`.
- [x] Backend sign-up: `SignUpDto` + `AuthService.signUp` take `username` (distinct 409 messages for
  email vs username); update e2e for the new sign-up body and add profile e2e cases.
- [x] Frontend sign-up: username field + schema (shared rules/reserved list in
  `lib/validation/profile-schemas.js`), error display; update test harness default `me` to include
  `username`.
- [x] Frontend profile page: `Profile.jsx` at `/u/:username` (TanStack Query, avatar placeholder,
  loading/not-found/error states, "Edit profile" on own profile); Home link to own profile.
- [x] Frontend edit page: `EditProfile.jsx` at `/settings/profile` (react-hook-form + zod, bio
  counter, server errors, cache updates, navigate to new profile URL).
- [x] Docs: Runbook (new endpoints, db reset note), backend/frontend architecture docs.
- [ ] Verify fix (Alejandro): sign-out race. On a fresh page load of `/sign-out`, the in-flight
  `GET /auth/me` (sent before the sign-out request) resolves 200 after `signOut` set me to `null`,
  restoring the user in the cache → `/sign-in` bounces to `/` showing the user as signed in, while
  the server session is already revoked. Also `POST /auth/sign-out` fires twice (both paths).
  Fix: cancel in-flight `['auth','me']` queries before clearing, so a late response can't restore
  the user; single sign-out request. Add a test that reproduces the race.
## Decisions
- 2026-09-24 · framed · Username required at sign-up (Alejandro) — no half-finished accounts, no
  onboarding step.
- 2026-09-24 · framed · Profiles visible to any signed-in user at `/u/:username`, editable only by
  the owner at `/settings/profile` (Alejandro). Everything stays auth-gated, per the existing rule.
- 2026-09-24 · framed · Dev DB reset instead of a backfill (Alejandro) — no production data exists;
  after pulling, run `npx prisma db push --force-reset` in `backend/` and re-create accounts.
- 2026-09-24 · framed · Profiles never expose email: other users' profiles return
  `{ username, bio, createdAt }`; email is only in the caller's own responses.
- 2026-09-24 · framed · Usernames stored lowercase so the existing unique index gives
  case-insensitive uniqueness on SQLite without a custom collation.
- 2026-09-24 · framed · Avatar is a placeholder only (initial + deterministic colour); real image
  upload is out of scope.
- 2026-09-24 · building · The reserved-username list is duplicated in
  `backend/src/modules/users/username.rules.ts` and `frontend/src/lib/validation/profile-schemas.js`,
  each pointing at the other: the repo-root `shared/` folder is empty and wired into neither build
  (backend is TS/nodenext, frontend plain JS). The backend copy is authoritative.
- 2026-09-24 · building · The dev-DB `--force-reset` was run by Alejandro himself: Prisma blocks
  AI-initiated destructive resets and requires the user's own consent, so the implementer stopped
  there instead of setting the consent variable. Until then, task 4's e2e ran against a throwaway
  `prisma/e2e-verify.db` (fresh file, plain `db push`, deleted after); re-run green on the reset
  dev DB afterwards.
- 2026-09-24 · building · `UserAvatar.jsx` (a thin composition of shadcn `Avatar`/`AvatarFallback`)
  signed off by Alejandro; listed in `knowledge/infra/ui-component-inventory.md`.
- 2026-09-24 · building · Prisma 7 + better-sqlite3 reports the colliding unique field under
  `meta.driverAdapterError.cause.constraint.fields` (no `meta.target`); `UsersService` reads that,
  then `meta.target`, then falls back to an email lookup to pick the 409 message.
- 2026-09-24 · verify · 21/22 checks passed against the running app; failed must-not-break: direct
  load of `/sign-out` leaves the UI signed in (me-refetch race; server session is revoked). Surfaced
  now because the removed `GET /` health check on Home used to 401 and reset the state. Clicking
  "Sign out" in-app works. Iterating (Alejandro).

## Follow-ups
- `frontend-architecture.md`'s `hooks/` comment lists only `use-profile.js` (also has the stock
  `use-mobile.js`) — incomplete, not wrong.
- [ ] (next, separate refactor after this feature closes — Alejandro) Move unit tests into a
  `__tests__/` folder per module/feature folder, backend AND frontend (e.g. `auth/__tests__/`,
  `modules/users/__tests__/`, `modules/users/dto/__tests__/`, `pages/__tests__/`,
  `lib/auth/__tests__/`); e2e stays in `backend/test/`. Make it a rule in `review-contract.md`
  §B/§C, the `implementer` agent, `/close-feature` Step 2, and the architecture docs.

## Log
- 2026-09-24 · framed
- 2026-09-24 · built — usernames (required at sign-up, lowercase-unique, reserved list) and bios on
  `User`; `GET /users/:username` (no email) + `PATCH /users/me`; `/u/:username` profile page with
  avatar placeholder and `/settings/profile` edit page. BE 10 suites / 123 unit + 36 e2e, FE 10 / 71,
  lint/build green.
