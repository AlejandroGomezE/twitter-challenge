---
slug: user-authentication
status: framed
scope: full-stack
next: /implement user-authentication
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
- [ ] Prisma: add `User` + `Session` models, `npx prisma db push` + `generate`.
- [ ] Backend deps + bootstrap: `argon2`, `cookie-parser`, `helmet`, `@nestjs/throttler`; `main.ts`
  (helmet, cookie-parser, CORS allowlist w/ credentials); env vars `FRONTEND_ORIGIN` (default
  `http://localhost:5173`), `NODE_ENV` in `environment.validation.ts`/`configuration.ts`/
  `.env.example`.
- [ ] `modules/users/`: `users.repository.ts` + `users.service.ts` (create with argon2id hash, find by
  email, find by id; never expose `passwordHash`).
- [ ] `auth/` sessions: `sessions.repository.ts` + session create/validate/revoke in `auth.service.ts`
  (token generation, SHA-256 at rest, expiry), cookie helpers.
- [ ] `auth/` endpoints: `auth.controller.ts` with sign-up/sign-in/sign-out/me, DTOs with
  class-validator, generic sign-in error + dummy-hash timing guard, throttling on sign-up/sign-in.
- [ ] `auth/` gating: global `AuthGuard` (`APP_GUARD`) + `@Public()` + `@CurrentUser()` + Origin
  check on state-changing requests; register in `app.module.ts`; update `test/app.e2e-spec.ts` to
  authenticate.
- [ ] Frontend auth core: `apiClient` `credentials: 'include'`; `lib/auth/` `AuthProvider` +
  `useAuth()` (backed by a `['auth','me']` query, sign-in/sign-up/sign-out mutations);
  `routes/ProtectedRoute.jsx`; router with public `/sign-in`, `/sign-up`, `/sign-out` and everything
  else behind `ProtectedRoute`.
- [ ] Frontend pages: `SignIn.jsx`, `SignUp.jsx` (react-hook-form + zod + shadcn `field`/`input`/
  `button`/`card`), `SignOut.jsx`; Home shows the user's email + sign-out button.
- [ ] Docs: Runbook (auth section, new env vars), backend/frontend architecture knowledge docs,
  ROADMAP.

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
  directly" is on its avoid list). `review-contract.md` §B still says services are the only layer
  touching `PrismaService` — the two disagree; see Follow-ups.
- 2026-09-24 · framed · `:5173` and `:3000` on `localhost` are the same *site*, so a `SameSite=Lax`
  cookie works in local dev without `SameSite=None`.

## Follow-ups
- `review-contract.md` §B ("Services own business logic and are the only layer touching
  `PrismaService`") contradicts `knowledge/infra/code-quality.md` (Controller → Service → Repository
  → ORM). Reconcile the contract to the repository layer before this feature's PR review.

## Log
- 2026-09-24 · framed
