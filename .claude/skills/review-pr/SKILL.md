---
name: review-pr
description: Review a PR on this repo (backend/ NestJS+Prisma, frontend/ Vite+React) against review-contract.md. Read-only by default — no build/test/rebase/push unless explicitly asked. Used standalone or by /close-feature. Triggers on "review the PR", "/review-pr <number>".
argument-hint: <PR number> [--execute]
---

# PR review

Read-only pass over one PR: gather, review against `review-contract.md`, report, act on the human's
decision.

**Executes nothing by default** — no `npm run build`/`test`/`lint`, no migrations, no
`start:dev`. **Never mutates the branch** — no checkout, merge, rebase, push, or commit. The only
writes this skill makes are `gh pr comment` / `gh pr merge`, and only per the human's decision.

---

## Step 1. Gather

```bash
gh pr view <n> --json number,title,url,state,headRefName,baseRefName,body,files
gh pr diff <n>
```

Derive `<slug>` from the branch/title and read `features/<slug>/feature.md` if it exists — its
`## Plan` is the acceptance criteria to review against (`review-contract.md` §A.4). If there's no
feature file (a PR opened outside the flow), say so and review against `review-contract.md` alone.

Read the changed files from disk (not just the diff — diffs truncate context). Use `Grep`/`Glob`/`rg`
to check against existing precedent.

## Step 2. Split the diff

Say which halves are touched — `backend/` only, `frontend/` only, or both — and apply
`review-contract.md` §B / §C accordingly.

## Step 3. Findings

Ordered Blocker → Warning → Nit (`review-contract.md` §A.1), each naming file:line. Apply §A.3 (no
hedges), §A.4 (don't re-litigate a met criterion), §A.5 (noise budget), §D (known non-findings)
before raising anything.

**Verdict:** *Ready to merge* / *Needs changes* / *Needs discussion*. One Blocker anywhere = the
verdict for the whole PR.

## Step 4. Execution — only if asked

If (and only if) explicitly asked to run something: `npm run build`/`test` in `backend/`,
`npm run build`/`test`/`lint` in `frontend/`. Report "N suites / M tests", not a bare number.

## Step 5. Act

- **Needs changes/discussion** → one PR comment with the blockers (`gh pr comment <n> --body "…"`).
  English, numbered, blockers only.
- **Ready** → ask whether to merge. On yes: `gh pr merge <n> --squash --delete-branch`. Don't attempt
  `gh pr review --approve` first (solo repo, GitHub rejects self-approval).

Confirm the PR number resolves to what you think it is (`gh pr view`) before any write action —
there's no undo on a merge.
