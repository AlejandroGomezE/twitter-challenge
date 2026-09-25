---
slug: readme-technical-decisions
status: verifying
scope: full-stack
next: /close-feature readme-technical-decisions
---
# Root README with technical decisions

Challenge §5.3 requires a README covering technical decisions: why this stack, how the timeline and
follow graph are modelled, how auth works, known trade-offs and limitations, and which AI tools were
used and how. Right now there's no root `README.md`. `Runbook.md` covers operations, `backend/README.md`
is mostly Nest boilerplate, `frontend/README.md` is 7 lines, and the reasoning lives in
`knowledge/infra/*`, the `features/*/feature.md` Decisions sections and `.claude/ROADMAP.md`.
Evaluators read the Runbook first, so the README needs to point there straight away and must not
duplicate or contradict it.

## Plan
- Touched surface: docs only; no product code.
  - new root `README.md`
  - a one-line pointer at the top of `Runbook.md` back to the README's technical decisions
  - possibly a line in `backend/README.md` / `frontend/README.md` pointing to the root README
- README outline (English, concise, evaluator-facing; each claim checked against the code):
  1. **What it is:** one paragraph, plus the feature list mapped to the challenge's required and
     bonus features: auth, profiles, tweets, timeline, follows, likes, search, responsive UI,
     realtime (SSE), notifications, Docker. Include comments, post detail and follow suggestions
     as extras.
  2. **Start here → `Runbook.md`:** prominent at the top, with the two shortest paths
     (`docker compose up --build`, or the local path) and the demo credentials
     (`demo@example.com` / `password1234`). Link to the Runbook for the rest, not a copy of it.
  3. **Stack and why:**
     - NestJS 12 + Prisma 7 + SQLite (better-sqlite3 adapter) on the backend
     - Vite + React + TypeScript + TanStack Query + Tailwind + shadcn/ui on the frontend
     - Vitest on both sides, plus MSW on the frontend
     - Say why each fits, including why the project moved from Postgres to SQLite (see
       `features/migrate-to-sqlite`) and what it would take to go back.
  4. **Architecture:**
     - a short map of `backend/src` (auth, modules/*, database, common) and `frontend/src`
       (pages, components, hooks, lib/api, lib/auth, lib/realtime)
     - the request path and layering (controller → service → repository), and response DTO
       serialization
     - link to `knowledge/infra/*` for depth
  5. **Timeline and follow graph:**
     - the `Follow` table with composite PK `(followerId, followingId)` and its two indexes
     - the Following feed ("you + people you follow") as a fan-out-on-read query
     - keyset/cursor pagination on `(createdAt, id)` with `Post @@index([createdAt])` /
       `[authorId, createdAt]`
     - For-you = everyone
     - counts and `likedByMe` are computed per page
     - why fan-out-on-read over fan-out-on-write at this scale, and where it would stop scaling
  6. **Authentication (custom, no third-party auth):**
     - argon2 password hashing
     - opaque random session tokens, with only their sha256 stored in `Session`
     - `httpOnly`, `SameSite=Lax` cookie (`Secure` in production)
     - a global `AuthGuard` with `@Public()` opt-outs
     - Origin check on state-changing requests (CSRF), sign-in/up rate limiting, constant-time
       failure (dummy hash)
     - frontend route guards
     - why server-side sessions rather than JWT
  7. **Bonus features, design notes:**
     - realtime over SSE (`/events`) and why SSE rather than WebSockets
     - notifications: event-driven via `@nestjs/event-emitter`, which types exist, read/unread,
       live badge. The challenge calls this "intentionally ambiguous", so state the choices.
     - Docker: production-like images, SQLite on a named volume, first-boot seed
  8. **Testing:**
     - where the tests live
     - unit vs e2e (a dedicated `e2e.db`) vs frontend MSW integration tests
     - the auth e2e flow, and which flows the frontend tests cover (login, create tweet, follow)
     - how to run coverage (`npm run test:cov`)
     - no coverage figure unless one is measured here (see Decisions)
  9. **Trade-offs and known limitations:**
     - SQLite and single-process realtime (the SSE hub in memory), so no horizontal scaling
       without Redis/pub-sub
     - no password reset or email verification
     - throttling per IP without `trust proxy`
     - fan-out-on-read cost
     - avatar placeholder only (no uploads)
     - no retweets or bookmarks
     - plus anything in `.claude/ROADMAP.md` and open feature Follow-ups worth stating honestly
  10. **AI usage and development process:**
      - Claude Code only (Alejandro)
      - the `.claude/` harness: the Frame → Build → Verify → Close flow; `implementer` /
        `reviewer` agents working in parallel with a fresh reviewer per task; the review
        contract; `features/<slug>/feature.md` as per-feature state; `knowledge/` as shared
        context
      - how that shows in the history: one PR per feature, merge commits, chore/feat/test
        commits
      - what was delegated and what was checked by hand: Verify runs the real app, merges are
        human-approved
- Acceptance criteria:
  1. The root `README.md` exists and covers every §5.3 "Technical decisions" item: stack and why,
     timeline and follow-graph modelling, authentication, trade-offs and limitations, AI tools and
     how they were used.
  2. Its first screen sends the reader to `Runbook.md` and gives the one-command Docker start plus
     the demo credentials.
  3. Every technical claim matches the code as it is on `main` (names, indexes, cookie flags,
     endpoints, commands). Nothing is aspirational.
  4. It doesn't duplicate the Runbook's setup steps or contradict it, and every relative link
     resolves.
- Must not break: the Runbook stays the single source for setup and operations. Existing anchors
  other docs link to (e.g. `Runbook.md#backend-backend`) stay unchanged.

## Tasks
- [x] (T1, be) Write the root `README.md` per the outline above. Take every fact from the code and
  the existing docs (`knowledge/infra/*`, `features/*/feature.md` Decisions, `.claude/*`,
  `Runbook.md`, `schema.prisma`, `src/auth/*`, the posts/follows repositories, the realtime and
  notifications modules). Don't copy long passages. Link to the deeper docs instead.
- [x] (T2, fe, after: T1) Cross-links: a pointer at the top of `Runbook.md` to the README's
  technical decisions, and a line in `backend/README.md` and `frontend/README.md` pointing to the
  root README and Runbook. Check that every relative link and anchor in all four files resolves.

## Decisions
- 2026-09-25 · framed · Slug `readme-technical-decisions` (Alejandro).
- 2026-09-25 · framed · AI tools: only Claude Code, with this repo's `.claude/` harness
  (Alejandro).
- 2026-09-25 · framed · The README holds the "why" and the Runbook holds the "how to run". The
  README links to the Runbook and doesn't repeat its setup steps, so the two can't drift apart.
- 2026-09-25 · framed · No coverage percentage in the README for now: nothing has measured it on
  `main` yet, and proving coverage and setting a threshold is its own change. The README says how
  to run coverage; the figure gets added when that change lands.
- 2026-09-25 · framed · Scope tagged `full-stack` because it documents both halves. T1 and T2 are
  tagged `be` / `fe` only to route them to an implementer; neither changes code.

- 2026-09-25 · building · Postgres → SQLite rationale, which the repo never recorded (Alejandro): zero setup for evaluators (no database server; clone + `db push` just works, so the Runbook is simpler and harder to break); fast, isolated tests (e2e gets its own file DB, `e2e.db`, and never touches dev data; no container needed); a simpler Docker stack (no DB container, just a file on a named volume). The README states these as the reasons.

- 2026-09-25 · closing · The PR #19 review pass found README.md:489 "Of the 131 commits, 19 are merges" off by one (main: 130 commits, 19 merges) and bound to go stale. Alejandro chose to drop the exact commit numbers and keep the history description qualitative; fixed via implement, then back to close.

## Follow-ups
- [ ] The README recommends Node 22+ (Node 20.11.1 was seen failing the frontend build), but `Runbook.md` and `scripts/check-env` still say Node >= 20.11 · the README flags the mismatch openly; fixing the Runbook/check-env minimum and pinning it is the separate Node-version change, and the README note should be updated to match when that lands.

## PRs
- #19 — https://github.com/AlejandroGomezE/twitter-challenge/pull/19

## Log
- 2026-09-25 · framed
- 2026-09-25 · built — root README.md (507 lines; §1–10 per outline, with claims checked against the code, the SQLite rationale from Alejandro, and a known setup gotchas section), plus cross-links from Runbook.md, backend/README.md and frontend/README.md; 65/65 relative links resolve; BE 47/609 and FE 52/606 green, builds + lint clean
- 2026-09-25 · verified — all 4 criteria pass: every §5.3 topic covered; first screen has docker compose, demo login and Runbook links; auth, CSRF, rate-limit, feed-paging and SSE claims checked with real requests on :3100 (cookie flags, sha256 token with 7-day expiry, sign-out revocation, identical 401s, 409, 403 on foreign Origin, 5/min sign-in, 10/min posts, likes unlimited, limit 1–50, 400 on bad cursors); 65/65 links resolve against GitHub-rendered headings; no Runbook heading changed; README not viewed in a browser
