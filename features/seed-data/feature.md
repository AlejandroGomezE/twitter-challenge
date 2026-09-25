---
slug: seed-data
status: verifying
scope: backend
next: /review-feature seed-data
---
# Seed data

Challenge §5.2: a seed that generates realistic data — at least 10 users with tweets, follows and
cross-likes — so the app shows content immediately after running it, plus sample credentials in the
docs (§5.3). Nothing like this exists today (no seed script, no `prisma db seed` config, no mention
in the Runbook).

## Plan
- Touched surface (backend + docs, no frontend code):
  - new `backend/src/database/seed/` — lives under `src/` so `nest build` compiles it to
    `dist/database/seed/` and it runs in the Docker runtime image (which ships `dist/` only, no
    tsx/ts-node). Split: a pure data module (users, posts, follows, likes, comments — no I/O) and a
    `runSeed(prisma, options)` function that writes it, and a thin CLI entry.
  - `backend/package.json` — `db:seed` script (build, then `node dist/database/seed/<entry>.js`).
  - `backend/prisma7.config.ts` — `migrations.seed` so `npx prisma db seed` runs the same thing.
  - `backend/docker-entrypoint.sh` + `compose.yaml` — seed on first boot only (see Decisions).
  - docs: `Runbook.md` (how to seed, reset, sample credentials; Docker note), `backend/README.md`,
    `knowledge/infra/backend-architecture.md` (where the seed lives).
- Data shape:
  - 30 users with hand-written, plausible profiles (username, displayName, bio), emails on
    `example.com`, all with the same password `password1234` (meets the 12–128 rule), hashed with
    argon2 using the **same options as sign-up** (reuse the existing constant, don't copy it). One
    is the documented demo account: `demo@example.com` / `password1234` (username `demo`).
  - 5–8 posts per user, hand-written (≤ 280 chars, same rule sign-up/posting uses), `createdAt`
    spread over the last ~14 days so the feed has a timeline, not one timestamp.
  - A follow graph that isn't complete: the demo user follows most (not all) users so Following
    and For-you differ; others follow a varied subset; no self-follows.
  - Cross-likes (every user likes several posts by others, never their own), a handful of
    comments, and a few notifications for `demo` (follow/like/comment, some unread) consistent
    with the seeded rows — rows are written directly, so the event listener doesn't create them.
  - Deterministic: fixed content and fixed offsets from "now" (no random, no faker dependency).
- Acceptance criteria:
  1. From a fresh clone following the Runbook (`npm install`, `cp .env.example .env`,
     `npx prisma db push`, `npm run db:seed`), the DB has 30 users, each with posts, plus
     follows, cross-likes and comments; `npx prisma db seed` does the same.
  2. Signing in as `demo@example.com` / `password1234` shows a non-empty Following feed (paginates
     via infinite scroll), a For-you feed, like counters > 0, profiles with followers/following
     lists, search results for e.g. "an", and the notifications page with unread items.
  3. Re-running `npm run db:seed` resets to the same data set (wipes seedable tables first) — no
     unique-constraint errors, no duplicates.
  4. `docker compose up --build` on a fresh volume comes up already seeded; restarting it
     (`down` + `up`) does **not** reseed or wipe data; `SEED_ON_START=false` skips it.
  5. Runbook documents the seed command, that it resets data, and the sample credentials.
- Must not break: e2e tests (they use their own `prisma/e2e.db`, never seeded), `scripts/be-local`,
  the Docker boot (schema push still first; a seed failure must fail the container loudly, not
  start a half-seeded app).

## Tasks
- [x] (T1, be) `backend/src/database/seed/`: the pure seed data module (users, posts, follow
  pairs, likes, comments, demo notifications, with relative timestamps) and `runSeed(prisma,
  { ifEmpty })` — in one transaction: wipe (Notification, Comment, Like, Follow, Post, Session,
  User), then insert; with `ifEmpty` it returns early if any user exists. Password hashed once with
  the sign-up argon2 options. Posts validated against the existing 280-char rule.
- [x] (T2, be, after: T1) CLI entry (parses `--if-empty`, builds a Prisma client the same way
  `PrismaService` resolves `DATABASE_URL`, logs a summary of counts, exits non-zero on failure);
  `db:seed` npm script; `migrations.seed` in `prisma7.config.ts`.
- [x] (T3, be, after: T2) Docker: `docker-entrypoint.sh` runs the seed with `--if-empty` after
  `prisma db push` unless `SEED_ON_START=false`; `compose.yaml` passes `SEED_ON_START` (default
  `true`). Check the runtime image contains everything the compiled seed imports.
- [x] (T4, be, after: T2, T3) Docs: `Runbook.md` (seed step in first-time setup, "Seed data"
  section — what it creates, reset semantics, sample credentials table; Docker first-boot note +
  `SEED_ON_START`), `backend/README.md`, `knowledge/infra/backend-architecture.md`.

## Decisions
- 2026-09-25 · framed · Slug `seed-data` (Alejandro).
- 2026-09-25 · framed · Before framing, `main` on GitHub turned out to be missing PR #17
  (docker-compose-stack): a history rewrite pushed at 17:04 UTC left `main` at the rewritten PR #16
  merge with no common ancestor to PR #17's merge commit. Alejandro chose to re-merge
  `docker-compose-stack` into `main` first (merge commit `ebb4c4e`, pushed), then branch
  `seed-data` from it.
- 2026-09-25 · framed · Seed code lives in `src/database/seed/` and runs compiled (`dist/`), not
  via tsx/ts-node: no new dependency, and the Docker runtime image can run it as-is.
- 2026-09-25 · framed · `db:seed` is a reset (wipe + insert), so it's repeatable and the documented
  credentials always work. Docker seeds only on an empty DB (`--if-empty`) so restarts keep user
  data; `down -v` gives a fresh seeded stack.
- 2026-09-25 · framed · Hand-written deterministic content instead of faker: reads as realistic,
  no extra dependency, and the docs can reference concrete users.
- 2026-09-25 · framed · 30 seed users rather than the 12 first proposed (Alejandro) — well over the §5.2 minimum of 10, enough for search, follow lists and suggestions to feel populated. Posts stay at 5–8 per user.
- 2026-09-25 · framed · Tests are written at Close (per `WORKFLOW.md`): a unit spec on the data
  module's invariants (30 users, unique usernames/emails, bodies ≤ 280, no self-follow/self-like,
  every user has posts) and an e2e spec that runs `runSeed` against the e2e DB and signs in as
  `demo`.

## Follow-ups
- [ ] The machine's default Node (v20.11.1) couldn't run the toolchain during Build; every check ran on Node v24.3.0 · Runbook/check-env say Node >= 20.11, which looks too low for Vite 8 / Vitest 4–5 — confirm the real minimum and pin it (`.nvmrc` / `engines`); separate change.
- [ ] `npm ci` in backend/ still needs `--legacy-peer-deps` (lockfile typescript peer issue, already noted in docker-compose-stack) · an evaluator following the Runbook literally may hit it; separate change.
- [ ] `features/docker-compose-stack/feature.md` is still `status: verifying` /
  `next: /close-feature` although PR #17 is merged · its close bookkeeping commit was never made;
  separate chore.

## Log
- 2026-09-25 · framed
- 2026-09-25 · built — seed module + runSeed, db:seed CLI \/ prisma db seed, Docker first-boot seeding (SEED_ON_START), Runbook seed section + sample credentials; verified against scratch DBs and a real docker compose run; BE build + lint clean, 45\/556 unit and 7\/205 e2e green
