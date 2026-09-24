---
name: feature
description: Use when starting a feature or a change on this repo (backend/ NestJS+Prisma, frontend/ Vite+React). The entry point — frames the feature (slug, scope, plan), quickly checks it doesn't already exist, writes features/<slug>/feature.md, and hands off to /implement. Triggers on "start a feature", "new feature", "let's build X", or "/feature".
argument-hint: <feature name, e.g. "user timeline" or "like button">
---

# Feature: $ARGUMENTS — Frame

You are the entry point into this repo's feature flow (`WORKFLOW.md`). Your job is **Frame**: confirm
the slug and scope, sanity-check it against the existing code, write `features/<slug>/feature.md`,
and hand off to `/implement`. You don't write code here.

Read `WORKFLOW.md` and `CONVENTIONS.md` (siblings of this skill's parent) first. Write the feature
file in English; talk to Alejandro in whatever language he uses.

---

## Step 1. Slug and scope

Derive the slug (kebab-case, `CONVENTIONS.md` §1) from "$ARGUMENTS" and confirm it with Alejandro.

If `features/<slug>/feature.md` already exists, tell him — either resume it (read its `next:`) or
pick a different slug.

## Step 2. Quick reality check (not a formal probe)

Before writing the plan, spend a few `Grep`/`Glob` calls checking the two things that actually bite:
- **Does something like this already exist?** (a similar component, endpoint, or hook worth reusing
  or extending instead of duplicating)
- **Roughly how big is this?** (one file, a handful, or does it touch both `backend/` and
  `frontend/`?)

This isn't a formal multi-question protocol — just enough to not build against a wrong assumption. If
something genuinely doesn't add up (the premise seems false), say so and stop before writing the
plan.

## Step 3. Branch check — before creating any artifact

**The current branch must match `<slug>` before you write anything.** This keeps
`features/<slug>/feature.md` and the code it describes on the same branch from the very first
commit — there's no separate "feature state landed on `main`, code landed on its own branch" split.

```bash
git branch --show-current
```

- **Already on a branch named `<slug>`** → proceed to Step 4.
- **Anything else** (`main`, another feature's branch, ...) → resolve it first:
  ```bash
  git fetch --prune origin
  git rev-parse --verify --quiet "<slug>" || git ls-remote --exit-code --heads origin "<slug>"
  ```
  - Branch exists (local or remote) → check it out (`git checkout <slug>`, or
    `git checkout --track origin/<slug>`).
  - Branch doesn't exist → create it from `main`: `git checkout -b <slug> main`.

**Never write `features/<slug>/feature.md` while the current branch doesn't match `<slug>`** — no
exceptions, including "just this once from `main`". If the check keeps failing for a reason you can't
resolve (dirty working tree, detached HEAD), stop and ask rather than writing on the wrong branch.

## Step 4. Write `features/<slug>/feature.md`

```markdown
---
slug: <slug>
status: framed
scope: backend | frontend | full-stack
next: /implement <slug>
---
# <Feature>

## Plan
- Touched surface: <files/areas, from Step 2>
- Acceptance criteria:
  1. <criterion>
  2. <criterion>
- Must not break: <existing behavior this could regress, if any>

## Tasks
- [ ] <task 1>
- [ ] <task 2>

## Decisions
- <ISO date or plain date> · framed · <any judgment call made here>

## Follow-ups

## Log
- <date> · framed
```

Keep the plan short — a handful of bullets, not a design document. Break the work into a **small
number of concrete tasks** under `## Tasks` (each roughly one file or one tightly-related group of
changes) — `/implement` will work through this list.

## Step 5. Hand off

Tell Alejandro the plan, in his language, and the next command:

> Next: `/implement <slug>`

Commit `features/<slug>/feature.md` (that path only — never `.claude/` or product code) as
`chore(<slug>): frame feature` (`CONVENTIONS.md` §9), push, and stop. The human advances — no
auto-chaining into `/implement`.

---

## When to stop and ask

If you can't tell how big this is, or the request is ambiguous enough that the plan would be a guess,
ask before writing it (`CONVENTIONS.md` §6).
