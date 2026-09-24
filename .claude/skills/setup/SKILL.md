---
name: setup
description: Verify the machine can run this repo (backend/ NestJS+Prisma, frontend/ Vite+React) and offer to fix gaps. Runs scripts/check-env, reports OK/MISSING, and with confirmation spawns the installer agent per gap. Triggers on "setup", "check my environment", or "/setup".
argument-hint: none, or --fix
---

# Setup — environment check

Verify this machine can run the app end-to-end, and help close any gaps. Read-only by default — you
never install or configure anything yourself; fixes go through the `installer` agent, one item at a
time, with confirmation.

## Step 1. Run the real check

```bash
bash scripts/check-env
```

This already covers: Node ≥20.11, npm, `backend/node_modules` + `frontend/node_modules` installed,
`backend/.env` present (and whether Observe APM credentials are set — optional, not blocking).

Add, read-only, what the script doesn't:
- `git config user.name` / `user.email` set.
- `gh --version` and `gh auth status` (the script only checks the binary is on PATH).
- `(cd backend && npm run build)` actually succeeds.
- `(cd frontend && npm run build)` actually succeeds.

**No database check blocks anything** — the database is a local SQLite file
(`backend/prisma/dev.db`, created by `npx prisma db push`) and the backend boots even before it
exists. If `DATABASE_URL` isn't set, that's worth noting, not a hard failure.

## Step 2. Present the checklist

In the user's language, one line per item: OK / MISSING / WARN, with what it blocks if missing (e.g.
"gh not authenticated → blocks opening PRs at Close").

## Step 3. Fix gaps, with confirmation

No MISSING items → say so, stop. Otherwise: ask which to fix (or all, with `--fix`), then spawn the
`installer` agent **once per item** — never fix more than one thing per invocation. Run independent
items in parallel; sequence dependent ones (install before build).

## Step 4. Re-check and confirm

Re-run the checks that were addressed, report what's now green vs. still blocked (and the remaining
manual step, if any).

---

If something doesn't fit this checklist at all, say so plainly rather than guessing — this is a
prerequisite utility, not a feature phase, so there's no `feature.md` to record an escalation in;
just ask.
