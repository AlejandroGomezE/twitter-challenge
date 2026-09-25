# CONVENTIONS.md — twitter-clone (execution contracts)

> Conventions every skill/agent in this flow follows. The full flow lives in
> [`WORKFLOW.md`](./WORKFLOW.md). Stack-specific code conventions (layering, what goes where) live in
> `knowledge/infra/` — this file is about *how the flow runs*, not about NestJS/React style.

## 0. Language

Artifacts (`feature.md`, skills, this file) are written in **English**. Converse with Alejandro in
whatever language he uses. Code identifiers are always English.

## 1. Feature slug

Kebab-case from the feature name (e.g. "user timeline" → `user-timeline`). It's the key everywhere:
`features/<slug>/`, the branch name, the PR title.

## 2. Per-feature state — `features/<slug>/feature.md`

One file. Frontmatter + sections:

```markdown
---
slug: <slug>
status: framed | building | verifying | done
scope: backend | frontend | full-stack
next: /<skill> <slug>        # the exact next command — rewritten at every phase close
---
# <Feature>

## Plan
<touched surface + acceptance criteria (2-4 bullets) + anything the change must not break>

## Tasks
- [ ] (T2, fe, after: T1) <task>
- [x] (T1, be) <task> — done

## Decisions
- <what was decided and why, including anything escalated to Alejandro and how it resolved>

## Follow-ups
- [ ] <out-of-scope thing noticed along the way> · <why it's out of scope>

## Log
- <date> · framed
- <date> · built — <one line>
- <date> · verified — <one line>
- <date> · closed — PR #<n>, merged
```

 Dates are plain (`YYYY-MM-DD` or
looser) — this isn't timing-instrumented, it's just enough to resume cold.

## 3. Status vocabulary

`framed` · `building` · `verifying` · `done` · `blocked` (waiting on a decision from Alejandro).

## 4. Orchestration

`/feature <name>` frames and hands off. Each phase is its own skill; it reads `features/<slug>/`,
does its work, updates `feature.md`, and tells you the next command. **The human advances** — no
silent auto-chaining between phases.

## 5. Code search

Use `Grep`/`Glob`, or `rg` via Bash for what they can't express. Exclude `node_modules` (both
`backend/` and `frontend/` have their own). There's no semantic-search MCP in this workspace.

## 6. When to stop and ask

Stop and ask Alejandro, rather than guessing, when: there's no precedent in the codebase for the
decision, an implementer/reviewer disagree twice in a row, or a product question has no owner. Write
the question and its answer under `## Decisions` once resolved, so it doesn't get re-asked.

## 7. Publishing feature state

When a phase closes: commit **only** `features/<slug>/` (never mix in product code or `.claude/`
itself), and rewrite `next:` in the frontmatter to the exact next command. Push if you can; if the
push fails, commit anyway and say the push is owed.

## 8. PR review — no execution by default

A review (`/review-pr`, or the `reviewer` agent) reads the diff and reports; it does **not** run
builds, tests, or migrations, and does **not** touch the branch (no checkout, merge, rebase, push,
commit) unless explicitly asked to. The rules for what counts as a finding live in
`review-contract.md` — this file only says a review doesn't execute or mutate by default.

## 9. Commit messages

Conventional-commit style, one line, imperative mood: `<type>(<slug>): <summary>`.

| Type | For |
|---|---|
| `feat` | A new feature or capability |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting only (whitespace, semicolons) — no logic change |
| `refactor` | Rewrites code cleaner without adding a feature or fixing a bug |
| `test` | Adds or updates tests |
| `chore` | Maintenance — deps, build tools, and this flow's own feature-state bookkeeping |

**Feature-state commits** (`features/<slug>/feature.md` and nothing else — §7 above) are always
`chore(<slug>): <what happened>`, e.g. `chore(user-timeline): frame feature`,
`chore(user-timeline): build complete`, `chore(user-timeline): closed`.

**Product-code commits** (the actual diff, at Close) use whichever type genuinely describes the
change — usually `feat` or `fix`; reach for `refactor`/`test`/`style`/`docs` only when that's really
all the commit does. Pick the type from what the diff does, not by default. PR titles follow the same
format.

## 10. Dev servers — leave nothing running

Any phase that starts the app (`scripts/be-local`, `scripts/fe-local`, `npm run start:dev`, a
background `npm run dev`, …) stops it before handing off: run `scripts/down-be` and/or
`scripts/down-fe` as the phase's last step, and confirm they report the port free. They kill the dev
tooling running out of `backend/` / `frontend/` — the nest / vite CLIs under `node_modules/`, each
with its whole process tree (the watched `node dist/main`, Vite's esbuild) — so they're safe to run
even when nothing is up. A backend started any other way (`npm run start:prod`, `node dist/main`) or
anything else holding the port is reported, never killed — tell Alejandro. So start the app only via
`be-local` / `fe-local` / `start:dev` / `dev`, never `start:prod`, or it won't be cleaned up. `/close-feature` runs both unconditionally, so a
finished feature never leaves orphaned servers behind.
