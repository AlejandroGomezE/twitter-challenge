---
name: review-feature
description: Use for the Verify phase of this repo's feature flow — after /implement (Build) is done. Runs the app for real (backend/ + frontend/) and checks the feature's acceptance criteria against the running app. Loops back to /implement if something's wrong. Triggers on "verify the feature", "review the feature", or /review-feature <slug>.
argument-hint: <slug>
---

# Verify: $ARGUMENTS

You are running **Verify** (`WORKFLOW.md`). This is a human checkpoint: the app runs for real, and
Alejandro confirms it actually does what `## Plan` in `features/<slug>/feature.md` says. It is not a
code review — it's driving the running app. When something's wrong, it's a loop back to `/implement`.

Read `WORKFLOW.md` and `CONVENTIONS.md` first. Write findings in English; talk to Alejandro in his
language.

---

## Step 1. Load context

`Read` `features/<slug>/feature.md`. If `status` isn't `verifying`, tell Alejandro to finish
`/implement <slug>` first — there's nothing running to check yet.

Build a short checklist from `## Plan`'s acceptance criteria.

## Step 2. Run it and drive the feature

Use the project's `run` pattern (or plainly `scripts/be-local` / `scripts/fe-local` per
`Runbook.md`) to get both halves up, then actually use the feature — click through it, or hit the
endpoint. **Don't substitute reading code for running it.**

For a UI change, a real browser check (e.g. via a headless-browser driver, screenshotting the result)
is worth more than eyeballing JSX. For a backend-only change, hitting the endpoint and checking the
response is the equivalent.

Walk the checklist:
- Every acceptance criterion, actually exercised.
- The states that matter (loading/error/empty/success) if the change has any.
- Anything the plan flagged as "must not break" — check it still works.

Record what passed/failed as you go. Don't fix anything here — Verify observes and reports; fixes
happen back in `/implement`.

## Step 3. Present findings

Tell Alejandro, in his language: what passed, what didn't (each with what you expected vs. what
happened), and ask for the verdict — **approve** or **iterate**.

## Step 4. Route the outcome

- **Iterate** → keep `status: building` don't advance it, tell him to run `/implement <slug>` again
  with the findings, then come back here. Append the findings to `## Decisions` or a fresh note so
  the next `/implement` round has them.
- **Approved** → set `next: /close-feature <slug>` in the frontmatter (`status` stays `verifying` —
  `/close-feature` is the one that sets `done`). Add a `## Log` line:
  `- <date> · verified — <one line>`.

Any out-of-scope thing you notice while driving the feature goes under `## Follow-ups`, not fixed
silently and not forgotten.

Commit `features/<slug>/` only, push.

> Next: `/close-feature <slug>` (if approved) or back to `/implement <slug>` (if iterating).

---

## Rules

- **Running evidence, not code reading.** Show it working; don't describe the source.
- **No dimension goes unassessed silently.** If you couldn't check something, say so explicitly and
  either iterate or note it under `## Follow-ups` — never a silent pass.
- **Alejandro decides.** Present, recommend, wait — don't decide for him.
