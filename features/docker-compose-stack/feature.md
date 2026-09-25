---
slug: docker-compose-stack
status: framed
scope: full-stack
next: /implement docker-compose-stack
---
# Docker + docker compose for the whole stack

## Plan
- Touched surface (all new unless noted): `backend/Dockerfile`, `backend/.dockerignore`,
  `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`, root `compose.yaml`,
  docs (`Runbook.md` + `README.md` "Run with Docker" section, `knowledge/infra/*` where they list
  how to run). No product code changes.
- Shape (production-like, chosen by Alejandro):
  - `backend` service — multi-stage image on `node:22-bookworm-slim` (glibc, so `better-sqlite3`'s
    native addon builds/loads; same base in build and runtime stages). Build: `npm ci`, `prisma
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
- [ ] (T1, be) `backend/Dockerfile` + `backend/.dockerignore`: multi-stage build as above; runtime
  stage keeps what `prisma db push` needs (Prisma CLI + `prisma/schema.prisma` +
  `prisma7.config.ts`) and runs `db push` then `node dist/main` via a small entrypoint; non-root
  user; `/data` owned by it.
- [ ] (T2, fe) `frontend/Dockerfile` + `frontend/nginx.conf` + `frontend/.dockerignore`: build with
  the `VITE_API_URL` build arg, serve `dist/` from nginx with SPA fallback and long-cache headers
  for hashed `/assets/*` (no-cache for `index.html`).
- [ ] (T3, be, after: T1, T2) root `compose.yaml`: `backend` (env, `db-data` volume at `/data`,
  healthcheck, `3000:3000`) and `frontend` (build arg, `8080:80`, `depends_on` backend healthy);
  verify `docker compose up --build` from a clean state and the acceptance criteria above.
- [ ] (T4, fe, after: T3) docs: "Run with Docker" in `Runbook.md` and `README.md` (the one
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

## Follow-ups

## Log
- 2026-09-25 · framed
