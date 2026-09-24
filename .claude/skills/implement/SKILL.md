---
name: implement
description: Use for the Build phase of this repo's feature flow — after /feature has written features/<slug>/feature.md. Works through its Tasks checklist, spawning implementer/reviewer per task, on backend/ (NestJS+Prisma) and/or frontend/ (Vite+React) as scope requires. Triggers on "implement the feature", "build it", or /implement <slug>.
argument-hint: <slug>
---

# Build: $ARGUMENTS

You are running **Build** (`WORKFLOW.md`). Your job: work through `features/<slug>/feature.md`'s
`## Tasks` checklist, one task (or a few independent ones) at a time, via `implementer` ⇄ `reviewer`.
Alejandro directs by iteration — summarize state in behavior terms, don't dump diffs unless asked.

Read `WORKFLOW.md` and `CONVENTIONS.md` first. Write artifacts in English; talk to Alejandro in his
language.

---

## Step 1. Load context

1. `Read` `features/<slug>/feature.md`. If it doesn't exist, tell Alejandro to run `/feature <name>`
   first.
2. Set `status: building` in the frontmatter.
3. Note `scope` — which of `backend/`, `frontend/` this touches.

## Step 2. Confirm the branch

`/feature` already created and checked out the `<slug>` branch before it wrote `feature.md` — this is
a verify, not a create:

```bash
git branch --show-current
```

- **Matches `<slug>`** → proceed.
- **Doesn't** (the session moved, or this is a resumed cold start) → resolve it the same way `/feature`
  Step 3 does: check out the existing `<slug>` branch (local or `origin/<slug>`), or create it from
  `main` if it truly doesn't exist yet. **Never implement on `main`.**

## Step 3. Work the task list

For each task still unchecked in `## Tasks` (a few independent ones may run in parallel via separate
`Agent` calls if they touch different files — most of the time just go one at a time):

1. **Implement** — spawn the `implementer` agent, passing the target stack (`backend` or `frontend`)
   and the task description plus any prior `REVIEW_NOTES`. It reads existing code for precedent
   (`Grep`/`Glob`) before writing.
   - `BLOCKED: …` → note it under `## Decisions` as an open question, ask Alejandro
     (`CONVENTIONS.md` §6).
   - `COMPLETED` → go to review.
2. **Review** — spawn a **fresh** `reviewer` agent (never reused) with the task + files changed.
   - `APPROVED` → check the task off in `feature.md`, move to the next task.
   - `REJECTED` → resume the *same* implementer with the reviewer's notes. After **2** rejections on
     the same task, stop and ask Alejandro rather than looping further.

## Step 4. Build & checks

- **`backend/`:** `npm run build` (stop on errors), then `npm test`. Report as "N suites / M tests".
- **`frontend/`:** `npm run build`, then `npm test`, then `npm run lint`. Report tests as "N suites /
  M tests". If a change breaks an existing test, fix the code or update the test deliberately — say
  which. New tests for the touched surface are written at Close (`/close-feature` Step 2).

Report failures; don't silently work around them — let Alejandro steer.

If you booted the app to check it (`scripts/be-local`, `npm run start:dev`, `npm run dev`, …), stop
it with `scripts/down-be` / `scripts/down-fe` before summarizing (`CONVENTIONS.md` §10).

## Step 5. Summarize and iterate

After each round, summarize in behavior terms: what's implemented, what's pending, anything blocked.
Let Alejandro steer — polish something, adjust a task, or advance. Repeat Steps 3–5 until he's
satisfied.

## Step 6. Hand off

Once the task list is done and checks are green:
1. Set `status: verifying` in `feature.md`, set `next: /review-feature <slug>`.
2. Add a `## Log` line: `- <date> · built — <one line>`.
3. Commit **only** `features/<slug>/` as `chore(<slug>): build complete` (`CONVENTIONS.md` §9) —
   product code stays uncommitted in the working tree; `/close-feature` makes the one product-code
   commit. Push.

> Next: `/review-feature <slug>`

---

## Rules

- **Never edit product code yourself** — that's what `implementer` is for. You orchestrate.
- **Fresh reviewer every time**; resume the same implementer on a reject (it keeps context).
- **Never override a reviewer rejection.**
- **Two rejections on one task → ask, don't keep looping** (`CONVENTIONS.md` §6).
- No PR here — that's `/close-feature`.
