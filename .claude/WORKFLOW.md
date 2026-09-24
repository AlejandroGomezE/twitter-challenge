# WORKFLOW.md — twitter-clone

> **Single source of the workflow.** A feature is owned end-to-end — one branch, one PR, touching
> `backend/` and/or `frontend/` — and Alejandro iterates on it until it's right; he directs, agents
> execute. This is deliberately **one lane**, modeled on what used to be called the "fast lane" in an
> earlier, much heavier version of this flow: light in ceremony, not in safety.
>
> It lives at the **repo root** (`.claude/`), so a Claude Code session started from the repo root
> discovers it automatically and sees both `backend/` and `frontend/`.

---

## The pipeline

```
Frame  →  Build  →  Verify  →  Close
 /feature   /implement   /review-feature   /close-feature
```

| Phase | Skill | What happens |
|---|---|---|
| **Frame** | `/feature <name>` | Confirm the slug and a one-paragraph scope, quickly check it doesn't already exist, write `features/<slug>/feature.md` with a short plan (touched surface + acceptance criteria). |
| **Build** | `/implement <slug>` | Break the plan into a small task list; `implementer` ⇄ `reviewer` loop per task until each is done. You direct by iteration — you don't need to read every diff. |
| **Verify** | `/review-feature <slug>` | Run the app for real (`scripts/be-local` / `scripts/fe-local`) and check the acceptance criteria against the running app, then stop it (`scripts/down-be` / `scripts/down-fe`). Loop back to Build if something's wrong. |
| **Close** | `/close-feature <slug>` | Write/run the tests the change actually needs (backend specs and frontend `*.test.jsx`), open the PR, run a `review-pr` pass, merge with your explicit go-ahead, and stop any dev servers left running (`scripts/down-be` + `scripts/down-fe`). |

The loop that matters is **Verify → Build**: you don't advance linearly, you go back and iterate until
it's actually right.

There is no separate "standard" track with more phases and formal gates. If a change turns out to be
large enough to want that (many files, a new data model, something you want to plan out loud before
touching code first), just say more up front at Frame time — the same four phases still apply, Frame
just does more thinking before Build starts.

---

## Roles

One person, Alejandro, doing everything: framing the feature, directing the build, verifying it
works, deciding whether to merge. No hat-switching ceremony — you just decide.

---

## Per-feature state — `features/<slug>/`

One file per feature, at the repo root (tracked and versioned, same repo as `backend/`/`frontend/`):

```
features/<slug>/feature.md
```

Sections: a short **Plan** (touched surface, acceptance criteria), a **Tasks** checklist, **Decisions**
(anything non-obvious you chose and why), and a **Log** (a few dated bullet lines — framed, built,
verified, closed; not a formal event schema, just enough to resume cold). No separate hub/plan/tasks/
review/journal/audit files — one doc is enough at this size.

**Commit scope.** `features/<slug>/` is feature state, committed on its own. The **flow definition**
(`.claude/`, `scripts/`) is edited directly when it needs to change — there's no separate governance
skill for it at this scale; just edit the file and say why.

---

## When something's uncertain

Any skill or agent that hits a genuinely low-confidence decision — no precedent in the codebase, an
ambiguous requirement, a product question nobody's answered — **stops and asks**, rather than
guessing. Note it under `## Decisions` in the feature file so the answer is written down once, not
re-asked next session.

---

## Merging

One person, so `gh pr review --approve` always fails (GitHub rejects self-approval) — don't try it.
Your explicit "merge it" *is* the approval. Squash-merge, delete the branch.

There's no auto-deploy configured for this project yet — merging to `main` doesn't ship anything by
itself. If/when that changes, update this line.
