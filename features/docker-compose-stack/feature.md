---
slug: docker-compose-stack
status: done
scope: full-stack
next: —
---
# Docker + docker compose for the whole stack

## Plan
- Touched surface (all new unless noted): `backend/Dockerfile`, `backend/.dockerignore`,
  `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`, root `compose.yaml`,
  docs (`Runbook.md` + `README.md` "Run with Docker" section, `knowledge/infra/*` where they list
  how to run), and `backend/.env.example` (`PORT=3000`, see Decisions). No app code changes.
- Shape (production-like, chosen by Alejandro):
  - `backend` service — multi-stage image: build / prod-deps stages on the full `node:22-bookworm`
    (python3/make/g++ for `better-sqlite3`), runtime on `node:22-bookworm-slim` + `openssl` (same
    Debian glibc and Node 22 ABI; see Decisions). Build: `npm ci`, `prisma
    generate`, `nest build`. Start: `prisma db push` (idempotent; the schema has no migrations
    folder) then `node dist/main`. Listens on 3000, published as `3000:3000`.
  - SQLite lives on a named volume (`db-data`), e.g. `DATABASE_URL=file:/data/app.db` — an
    absolute path, which `prisma.service.ts` / `prisma7.config.ts` pass through unchanged.
  - `frontend` service — multi-stage: `npm ci` + `npm run build` (runs `tsc -b` then `vite build`)
    with `VITE_API_URL` as a build arg (default `http://localhost:3000`), then the `dist/` served
    by `nginx:alpine` with SPA fallback (`try_files $uri /index.html`). Published as `8080:80`.
  - Backend env from compose: `FRONTEND_ORIGIN=http://localhost:8080` (CORS + Origin check must
    match the served frontend exactly), `NODE_ENV=development` (see Decisions), `PORT=3000`,
    optional `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` passed through from the host env if set.
  - `backend` has a healthcheck; `frontend` `depends_on` it (`condition: service_healthy`).
- Acceptance criteria:
  1. From a fresh clone with only Docker installed, `docker compose up --build` (one command)
     builds both images and brings the stack up; no host Node / npm / Prisma step needed.
  2. http://localhost:8080 serves the app; a deep link (e.g. `/u/ada`, `/explore`) reloads without
     a 404 (SPA fallback).
  3. Sign up → post → like → comment → follow works end to end in the browser against the
     containerised API, including the realtime stream (`GET /events`) and the session cookie.
  4. Data survives `docker compose down` + `up` (named volume); `docker compose down -v` resets it.
  5. Docs say how to run it, which ports it uses, how to reset the DB and how to change the API URL.
- Must not break: the existing non-Docker workflow (`scripts/be-local`, `scripts/fe-local`,
  `backend/prisma/dev.db`, `npm test` in both apps). `.dockerignore`s must keep host
  `node_modules`, `dist`, `.env` and `*.db` out of the build context.

## Tasks
- [x] (T1, be) `backend/Dockerfile` + `backend/.dockerignore`: multi-stage build as above; runtime
  stage keeps what `prisma db push` needs (Prisma CLI + `prisma/schema.prisma` +
  `prisma7.config.ts`) and runs `db push` then `node dist/main` via a small entrypoint; non-root
  user; `/data` owned by it.
- [x] (T2, fe) `frontend/Dockerfile` + `frontend/nginx.conf` + `frontend/.dockerignore`: build with
  the `VITE_API_URL` build arg, serve `dist/` from nginx with SPA fallback and long-cache headers
  for hashed `/assets/*` (no-cache for `index.html`).
- [x] (T3, be, after: T1, T2) root `compose.yaml`: `backend` (env, `db-data` volume at `/data`,
  healthcheck, `3000:3000`) and `frontend` (build arg, `8080:80`, `depends_on` backend healthy);
  verify `docker compose up --build` from a clean state and the acceptance criteria above.
- [x] (T4, fe, after: T3) docs: "Run with Docker" in `Runbook.md` and `README.md` (the one
  command, ports, DB reset with `down -v`, overriding `VITE_API_URL` / `FRONTEND_ORIGIN`, the
  `NODE_ENV` note), and a line in `knowledge/infra/` where local running is described.

## Decisions
- 2026-09-25 · framed · Slug `docker-compose-stack` (Alejandro).
- 2026-09-25 · framed · Production-like stack, not a hot-reload dev setup (Alejandro): built
  images, `node dist/main`, static frontend on nginx. Hot reload stays with `scripts/be-local` /
  `fe-local`.
- 2026-09-25 · framed · No database container: the app uses SQLite (a file), kept on a named
  volume. Schema applied with `prisma db push` at container start, matching the Runbook's
  no-migrations setup.
- 2026-09-25 · framed · `NODE_ENV=development` in compose by default. In this backend `NODE_ENV`
  only controls the session cookie's `Secure` flag, and the stack is served over plain
  `http://localhost`, where some browsers (Safari) drop `Secure` cookies — sign-in would silently
  fail. Overridable to `production` when the stack sits behind HTTPS.
- 2026-09-25 · framed · The browser talks to the API directly on `:3000` (baked `VITE_API_URL`),
  not through an nginx `/api` proxy — keeps the frontend image static and avoids SSE buffering
  config; CORS is already scoped by `FRONTEND_ORIGIN`.

- 2026-09-25 · building · Build stages use the full `node:22-bookworm` image, not slim + apt: the
  direct dependency `better-sqlite3@13.0.3` has no prebuilt binary (its install script is only
  `node-gyp rebuild`), so a compiler is always required. Found in a real `docker build`.
- 2026-09-25 · building · Runtime installs `openssl`: without it Prisma mis-detects openssl-1.1.x
  and tries to download a schema engine into the root-owned `node_modules`, so the container never
  boots (observed in a real run).
- 2026-09-25 · building · No `--skip-generate` on `prisma db push` (reviewer asked for it in round
  1): Prisma 7.10.0 removed both the auto-generate and the flag, and passing it exits 1. Verified
  in the built image; the round-2 reviewer approved on that evidence.
- 2026-09-25 · building · Entrypoint forwards SIGTERM/SIGINT to node instead of `exec`: the app
  installs no signal handler, so node as PID 1 ignored SIGTERM and `docker stop` took 10s (now
  <1s).
- 2026-09-25 · building · Verified in this sandbox with real `docker compose up --build` +
  Playwright (sign-up, post, like, comment, follow, live notifications badge, persistence, `down
  -v`). The sandbox needed build-only tweaks kept out of the repo (proxy CA, host network; its
  apt mirror is blocked, so the runtime `apt-get install openssl` line itself was stood in for by
  copying the same bookworm openssl from `node:22-bookworm`).

- 2026-09-25 · verifying · Found while checking "must not break": `backend/.env.example` shipped
  `PORT=` empty, which fails validation (`z.coerce` turns `''` into 0; the 3000 default only applies
  when the variable is absent), so a straight copy of the example wouldn't boot `be-local`.
  Pre-existing on `main`, unrelated to Docker; Alejandro chose to fix it in this feature. Now
  `PORT=3000` with a comment — explicit rather than commented out, because `be-local`, `down-be`
  and `check-env` read `PORT=` from `backend/.env`. Verified: an unedited copy boots (`/auth/me`
  401) and `check-env` reports `PORT=3000`.

## Follow-ups
- [x] `backend/package-lock.json` fails a plain `npm ci` on npm 10 ("Missing: typescript@5.9.3",
  tsconfck's optional peer vs typescript 6), so the Dockerfile uses `--legacy-peer-deps` · a
  pre-existing lockfile issue, not caused by this feature; regenerating the lockfile is its own
  change. · **fixed** (setup-fixes branch)
- [ ] Two `better-sqlite3` versions ship (13.0.3 direct, 12.11.1 under the Prisma adapter) · the
  direct dependency looks unused by `src/`; dropping it would remove the compile step · product
  dependency change, out of scope.
- [x] `scripts/check-env` is mode 100644 in git, so `scripts/check-env` gives "Permission denied"
  (`bash scripts/check-env` works) · pre-existing. · **fixed** (setup-fixes branch)
- [ ] A root `.env` would feed compose interpolation (`VITE_API_URL`, `FRONTEND_ORIGIN`) but isn't
  gitignored at the root · docs tell people to use the host environment instead; gitignoring it is
  a separate tidy-up.

## PRs
- #17 — https://github.com/AlejandroGomezE/twitter-challenge/pull/17

## Log
- 2026-09-25 · framed
- 2026-09-25 · built — backend/frontend images, compose.yaml and Docker docs; verified with a real `docker compose up --build` + Playwright e2e in the sandbox; BE 44/553, FE 52/606 tests green, lint clean
- 2026-09-25 · verified — clean `docker compose up --build` from scratch: all 5 acceptance criteria pass (Chromium e2e incl. live notifications, persistence, `down -v` reset, <1s shutdown); local be-local/fe-local unaffected; runtime `apt-get install openssl` line not exercised (sandbox blocks deb.debian.org)
- 2026-09-25 · closed — PR #17, merged (efded13). A later history rewrite dropped it from `main`, so it was re-merged as ebb4c4e before seed-data. This record was closed afterwards on the setup-fixes branch.
