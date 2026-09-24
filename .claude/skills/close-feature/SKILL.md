---
name: close-feature
description: Use for the Close phase of this repo's feature flow — after /review-feature (Verify) approved. Writes tests for the touched surface, opens the PR, runs a review-pr pass, merges with explicit human authorization. Triggers on "close the feature", "ship it", or /close-feature <slug>.
argument-hint: <slug>
---

# Close: $ARGUMENTS

You are running **Close** (`WORKFLOW.md`) — the single close phase: tests for what actually changed,
one PR, a review pass, merge on Alejandro's word.

Read `WORKFLOW.md` and `CONVENTIONS.md` first. Write artifacts in English; talk to Alejandro in his
language.

---

## Step 1. Load context

`Read` `features/<slug>/feature.md`. If Verify hasn't approved (no `next: /close-feature <slug>`),
tell Alejandro to finish `/review-feature <slug>` first.

## Step 2. Tests for the touched surface

Not a full coverage sweep — just what this change actually touched:

- **`backend/`** — a unit spec for the changed service/logic, at
  `backend/src/<module>/*.spec.ts`, dependencies mocked (no real database in a unit spec).
- **`frontend/`** — a colocated `*.test.jsx`/`*.test.js` next to each changed page, component or
  hook (`src/pages/Home.test.jsx` is the reference). Render with `renderWithProviders` from
  `src/test/render.jsx`, query by role/text, drive interactions with its `user`. Fake the backend
  with MSW (`server.use(http.get(apiUrl('/path'), …))` from `src/test/server.js`) — never mock
  `apiClient`/`fetch`, never hit a real backend. Cover the states the change has
  (loading/error/empty/success). shadcn primitives in `src/components/ui/*` aren't tested. Then
  `npm test` + `npm run build` + `npm run lint`.

Run them until green — "N suites / M tests", not a bare number.

## Step 3. Commit and open the PR

Pick the commit type from what the diff actually does (`CONVENTIONS.md` §9) — usually `feat` or
`fix`; `refactor`/`test`/`docs`/`style` only when that's genuinely all it is. The PR title follows
the same format.

```bash
git add <changed files>            # never .env* or anything with a secret
git commit -m "<type>(<slug>): <summary>"
git push origin <branch>
gh pr create --base main --title "<type>(<slug>): <summary>" \
  --body "<what changed · acceptance criteria met · test results>"
```

Record the PR URL under a `## PRs` line in `feature.md` (add the section if it's not there).

## Step 4. Light review pass

Run `/review-pr` over this PR (or the checklist inline — see that skill). Report findings by
severity. **Alejandro decides**: ready to merge, or changes needed.

- **Changes needed** → post the blockers as one PR comment, keep working via `/implement <slug>`,
  come back here.
- **Ready** → Step 5.

## Step 5. Merge

On explicit "merge it":

```bash
gh pr merge <n> --merge --delete-branch
```

Don't try `gh pr review --approve` first — solo repo, GitHub always rejects self-approval
(`WORKFLOW.md`). Alejandro's "merge it" already is the approval.

If it errors, check `gh pr view <n> --json state` before assuming it failed — a local sync failure
after a real GitHub-side merge shows as `MERGED` there.

No auto-deploy is configured for this project (`ROADMAP.md`) — say so, don't describe one.

## Step 6. Close the record

1. Tick any `## Follow-ups` items this closed, or leave them as open items — never silently drop one.
2. Set `status: done`, `next: —` in `feature.md`.
3. Add `## Log`: `- <date> · closed — PR #<n>, merged`.
4. Commit `features/<slug>/` only as `chore(<slug>): closed` (`CONVENTIONS.md` §9), push.
5. Run `scripts/down-be` and `scripts/down-fe` — always, even if you don't think anything is
   running — and confirm both ports are free (`CONVENTIONS.md` §10). Report anything they couldn't
   stop.

Tell Alejandro it's done. Stop.

---

## Rules

- **Test the touched surface, not everything.**
- **Leave nothing running.** A closed feature ends with `scripts/down-be` + `scripts/down-fe`.
- **One PR, Alejandro decides the merge.** Always a merge commit (`--merge`) — never `--squash` or
  `--rebase`; the feature's full commit history stays in `main`.
- **Never `gh pr review --approve`** on this solo repo.
- Follow-ups get resolved or explicitly carried forward — never silently forgotten.
