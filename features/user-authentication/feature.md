---
slug: user-authentication
status: verifying
scope: full-stack
next: /close-feature user-authentication
---
# User authentication (email + password)

## Plan
- Touched surface:
  - `backend/prisma/schema.prisma` — first models: `User` (email unique, `passwordHash`,
    timestamps) and `Session` (`tokenHash` unique, `userId`, `expiresAt`, `createdAt`).
  - `backend/src/modules/users/` — `users.repository.ts` (Prisma access), `users.service.ts`.
  - `backend/src/auth/` — the shape already specified in `knowledge/infra/code-quality.md`:
    `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `auth.guard.ts` (global `APP_GUARD`),
    `public.decorator.ts`, `current-user.decorator.ts`, `authenticated-user.interface.ts`,
    `sessions.repository.ts`, `dto/`.
  - `backend/src/main.ts` (helmet, cookie-parser, CORS with explicit origin + credentials),
    `backend/src/app.module.ts`, `backend/src/config/*` (new env vars), `backend/.env.example`,
    `backend/test/app.e2e-spec.ts`.
  - `frontend/src/lib/api/client.js` (`credentials: 'include'`), `frontend/src/lib/auth/`
    (`AuthProvider`, `useAuth()`), `frontend/src/routes/ProtectedRoute.jsx`,
    `frontend/src/pages/SignIn.jsx`, `SignUp.jsx`, `SignOut.jsx`, `frontend/src/app/router.jsx`,
    `frontend/src/pages/Home.jsx`.
  - Docs: `Runbook.md`, `knowledge/infra/backend-architecture.md`,
    `knowledge/infra/frontend-architecture.md`, `.claude/ROADMAP.md` ("No auth module" bullet).
- API (all JSON):
  - `POST /auth/sign-up` `{ email, password }` → 201, creates the user, signs them in (sets cookie),
    returns `{ id, email }`. **Public.**
  - `POST /auth/sign-in` `{ email, password }` → 200 + cookie, returns `{ id, email }`. **Public.**
  - `POST /auth/sign-out` → 204, deletes the session server-side (if any) and clears the cookie.
    **Public** and idempotent.
  - `GET /auth/me` → 200 `{ id, email }` or 401. Gated.
  - Every other endpoint (incl. the existing `GET /`) → 401 without a valid session.
- Security measures:
  1. **Password hashing:** argon2id (`argon2` package) — unique random salt per hash built in,
     OWASP-recommended cost params (m=19 MiB, t=2, p=1). Plaintext never stored or logged.
  2. **Password policy (NIST 800-63B):** 12–128 chars, no composition rules; max length caps hashing
     cost (DoS guard). Email trimmed + lowercased, validated, unique.
  3. **No account enumeration on sign-in:** one generic `401 Invalid email or password` for unknown
     email and wrong password; unknown emails still run an argon2 verify against a dummy hash so
     timing doesn't leak which case happened.
  4. **Sessions:** 32 random bytes (`crypto.randomBytes`) as the token; only its SHA-256 hash is
     stored. Cookie `sid`: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, 7-day
     absolute expiry enforced server-side (expired rows rejected and deleted). A fresh session on every
     sign-in/sign-up (no fixation); sign-out revokes it in the DB.
  5. **Brute-force limits:** `@nestjs/throttler` on `sign-in`/`sign-up` (5 requests / minute / IP),
     `429` beyond that.
  6. **CSRF:** `SameSite=Lax` + CORS allowlist (`FRONTEND_ORIGIN`, `credentials: true`, never `*`) +
     the guard rejects state-changing requests (`POST/PUT/PATCH/DELETE`) whose `Origin` header isn't
     `FRONTEND_ORIGIN`.
  7. **Headers:** `helmet` defaults.
  8. **No leakage:** responses and logs never include `passwordHash`/tokens; DTOs `whitelist` already
     strips unknown fields.
- Acceptance criteria:
  1. Sign-up with a new email + valid password → 201, `sid` cookie set with the flags above, `User`
     row stores an `$argon2id$` hash (never the plaintext); two users with the same password get
     different hashes.
  2. Sign-up with a taken email → 409; with an invalid email or a password outside 12–128 chars →
     400.
  3. Sign-in with correct credentials → 200 + a new session cookie; wrong password and unknown email
     both → the same 401 body.
  4. `GET /auth/me` and `GET /` → 401 without a cookie, 200 with a valid one, 401 after sign-out or
     after the session expires.
  5. A 6th sign-in attempt within a minute from the same IP → 429.
  6. A `POST` with a foreign `Origin` → 403.
  7. Frontend: every route except `/sign-in`, `/sign-up` and `/sign-out` redirects to `/sign-in` when
     signed out (and back to the originally requested route after signing in); `/sign-in` and
     `/sign-up` redirect to `/` when already signed in.
  8. Frontend: sign-in/sign-up forms validate client-side (same rules), show the server's error on
     failure, and loading state while submitting; Home shows the signed-in email and a sign-out
     button; `/sign-out` signs out and lands on `/sign-in`.
  9. A session survives a page reload (the cookie, not JS state, is the source of truth).
- Must not break: backend boot/env validation (new vars get defaults for local dev), `npm test` /
  `test:e2e` in `backend/` (e2e must sign in first), `npm test` / `build` / `lint` in `frontend/`,
  `scripts/be-local` + `scripts/fe-local` still working together locally (cookie across
  `:5173` → `:3000`).

## Tasks
- [x] Prisma: add `User` + `Session` models, `npx prisma db push` + `generate`.
- [x] Backend deps + bootstrap: `argon2`, `cookie-parser`, `helmet`, `@nestjs/throttler`; `main.ts`
  (helmet, cookie-parser, CORS allowlist w/ credentials); env vars `FRONTEND_ORIGIN` (default
  `http://localhost:5173`), `NODE_ENV` in `environment.validation.ts`/`configuration.ts`/
  `.env.example`.
- [x] `modules/users/`: `users.repository.ts` + `users.service.ts` (create with argon2id hash, find by
  email, find by id; never expose `passwordHash`).
- [x] `auth/` sessions: `sessions.repository.ts` + session create/validate/revoke in `auth.service.ts`
  (token generation, SHA-256 at rest, expiry), cookie helpers.
- [x] `auth/` endpoints: `auth.controller.ts` with sign-up/sign-in/sign-out/me, DTOs with
  class-validator, generic sign-in error + dummy-hash timing guard, throttling on sign-up/sign-in.
- [x] `auth/` gating: global `AuthGuard` (`APP_GUARD`) + `@Public()` + `@CurrentUser()` + Origin
  check on state-changing requests; register in `app.module.ts`; update `test/app.e2e-spec.ts` to
  authenticate.
- [x] Frontend auth core: `apiClient` `credentials: 'include'`; `lib/auth/` `AuthProvider` +
  `useAuth()` (backed by a `['auth','me']` query, sign-in/sign-up/sign-out mutations);
  `routes/ProtectedRoute.jsx`; router with public `/sign-in`, `/sign-up`, `/sign-out` and everything
  else behind `ProtectedRoute`.
- [x] Frontend pages: `SignIn.jsx`, `SignUp.jsx` (react-hook-form + zod + shadcn `field`/`input`/
  `button`/`card`), `SignOut.jsx`; Home shows the user's email + sign-out button.
- [x] Docs: Runbook (auth section, new env vars), backend/frontend architecture knowledge docs,
  ROADMAP.
- [x] Response serialization (Alejandro, after first build): every endpoint returns a response DTO
  (`class-transformer` `@Expose()` whitelist) through a global `ClassSerializerInterceptor` with
  `excludeExtraneousValues`, so only explicitly exposed fields can leave the API — `UserResponseDto`
  for sign-up/sign-in/me, `MessageResponseDto` for `GET /`; sign-out stays 204 with no body. Docs
  and review contract updated to require it for every future endpoint.
- [x] Close-phase fixes (found by Close tests, Alejandro chose to fix now): (a) after sign-in the
  user always lands on `/` — `PublicOnlyRoute`'s `<Navigate to="/">` beats `SignIn`'s navigate to
  `state.from`; make `PublicOnlyRoute` redirect to the guarded `from` target (shared guard fn).
  (b) a non-401 failure of `/auth/me` (500/network) is treated as signed out → redirect to
  `/sign-in`; instead gated routes show a "Couldn't reach the server" error with Retry — only a 401
  means signed out.

## Decisions
- 2026-09-24 · framed · Public sign-up included (Alejandro), in addition to the sign-in/sign-out
  exceptions he named — otherwise there's no way to create a user.
- 2026-09-24 · framed · Server-side sessions (opaque token in an httpOnly cookie, hash in a
  `Session` table) over JWT (Alejandro) — real revocation on sign-out, nothing readable by JS.
- 2026-09-24 · framed · argon2id over bcrypt: memory-hard, OWASP's first choice, no 72-byte input
  truncation. Salt is generated per hash by the library; no separate salt column needed (it's
  encoded in the hash string).
- 2026-09-24 · framed · Sign-up returns 409 for a taken email. That does reveal whether an email is
  registered; accepted trade-off for a usable sign-up form, mitigated by the rate limit. Sign-in
  stays fully non-enumerating.
- 2026-09-24 · framed · Prisma access goes through repositories (`users.repository.ts`,
  `sessions.repository.ts`), per `knowledge/infra/code-quality.md` ("Services that access Prisma
  directly" is on its avoid list). Alejandro confirmed; `review-contract.md` §B and the `implementer`
  agent were updated to match before Build.
- 2026-09-24 · framed · `:5173` and `:3000` on `localhost` are the same *site*, so a `SameSite=Lax`
  cookie works in local dev without `SameSite=None`.
- 2026-09-24 · building · Task 6 (guard) was built before task 5 (endpoints) so the controller
  could use `@Public()`/`@CurrentUser()` directly instead of being rewritten.
- 2026-09-24 · building · Additions beyond the task list, each reviewed: `backend/src/app.setup.ts`
  (`configureApp`, shared by `main.ts` and e2e so e2e exercises the real HTTP pipeline);
  `frontend/src/app/query-client.js` (`createQueryClient` with central 401 handling — on a
  session-expired 401 it nulls `me` and drops all other cached queries);
  `frontend/src/lib/auth/auth-error-message.js`; `ARGON2_OPTIONS` exported from `users.service.ts`
  so the sign-in dummy hash uses identical params.
- 2026-09-24 · building · Review-driven hardening: CORS origin passed as a one-element array (a
  plain string made `cors` reflect the allowed origin to foreign origins too); `FRONTEND_ORIGIN`
  must be an exact origin (no path/trailing slash) and fails boot with the formatted error; dummy
  hash precomputed in `onModuleInit` (no first-request timing difference); sign-in redirect rejects
  `//` and `/\` paths (no open redirect).
- 2026-09-24 · building · Flow docs updated to match: `implementer` agent (auth exists, gated by
  default, new frontend folders) and `review-contract.md` §B (queries scoped by current user; an
  unrequested `@Public()` is a Blocker).
- 2026-09-24 · building · Alejandro: handlers returned plain objects with no serialization layer, so
  nothing enforced what leaves the API. Added a response-DTO task: whitelist serialization
  (`@Expose` + `excludeExtraneousValues`) on every endpoint, enforced for future endpoints in
  `review-contract.md` §B and the `implementer` agent.
- 2026-09-24 · building · Serialization fails CLOSED: `ResponseSerializerInterceptor` (extends
  `ClassSerializerInterceptor`, `excludeExtraneousValues: true`) returns 500 for any body whose
  handler didn't declare `@SerializeOptions({ type: XResponseDto })` — the stock interceptor passes
  plain objects through unfiltered when no type is declared, so a forgotten decorator would have
  leaked data silently.
- 2026-09-24 · closing · Close-phase frontend tests found that AC7's "back to the originally
  requested route" was broken (always `/`). Verify had marked it passing: the probe saw a navigation
  to the target but misattributed the follow-up `/` to the catch-all (only `/` exists today). Fixed
  in a short Build round rather than shipped (Alejandro).
- 2026-09-24 · closing · `/auth/me` failing with 500/network must not look like "signed out";
  gated routes show an error + Retry instead (Alejandro). Only 401 → signed out.

## Follow-ups
- [x] ~~`review-contract.md` §B contradicted `knowledge/infra/code-quality.md` on where Prisma access
  lives~~ — fixed: repositories are the only layer injecting `PrismaService` (contract §B,
  `implementer` agent, backend-architecture doc).

- `argon2`'s install script (`node-gyp-build`) is blocked by npm's install-scripts policy; it works
  because a prebuilt binary exists for this platform (Windows x64). On a platform without one, run
  `npm install-scripts approve argon2` in `backend/` (or add it to `allowScripts`).
- For Close — tests still to write: `AuthService` unit spec (call `onModuleInit()` before
  `signIn`, since the dummy hash is computed there); `UsersService` spec (argon2id params, P2002 →
  409, `toPublicUser` never includes `passwordHash`); frontend `*.test.jsx` for `SignIn` (incl. the
  `from` redirect guard), `SignUp` (validation, 409/429 messages), `SignOut` (redirects on success
  AND failure — reviewer noted `signOut` clears the mutation cache while that mutation is in
  flight; confirm it still settles), `ProtectedRoute`/`PublicOnlyRoute`, `AuthProvider`, and the
  401 handling in `query-client.js`. Already covered: `auth.guard.spec.ts` (13) + e2e (11).
- `knowledge/infra/code-quality.md` still describes auth shapes as guidance; they now point to the
  architecture docs. Fine as-is.
- File-download endpoints (`StreamableFile`) and raw string bodies would get a 500 from the
  fail-closed serializer unless they declare a type; add a `StreamableFile` passthrough (+ doc line)
  when the first download endpoint is built. None exists today.

## Log
- 2026-09-24 · framed
- 2026-09-24 · built — email+password auth end to end: argon2id users, hashed cookie sessions,
  global guard + `@Public()`, Origin/CSRF check, 5/min/IP throttling, helmet + CORS allowlist; React
  auth context, gated routes, sign-in/up/out pages. BE 19 unit + 11 e2e, FE 9 tests, lint/build green.
- 2026-09-24 · built — response serialization added on Alejandro's request: response DTOs on every
  endpoint, fail-closed whitelist interceptor, flow docs require it. BE 23 unit + 12 e2e, FE 9 tests,
  lint/build green.
- 2026-09-24 · verified — all 9 acceptance criteria exercised against the running app (curl on the
  API, headless Chrome for the UI: 19/19 UI checks, argon2id/SHA-256/expiry confirmed in the DB).
- 2026-09-24 · built — close-phase fixes: sign-in returns to the requested route (redirect target in
  `PublicOnlyRoute`), `/auth/me` server errors show an error + Retry instead of "signed out".
- 2026-09-24 · verified — re-ran the UI checks (19/19) plus the new error state (4/4: backend down →
  error + Retry, sign-in still usable, Retry → correct route) against the running app.
