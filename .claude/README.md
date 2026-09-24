# twitter-clone workflow

A lightweight feature-development flow over this repo: **`backend/`** (NestJS · Prisma) and
**`frontend/`** (Vite · React · TanStack Query · shadcn). One person (Alejandro), one lane, four
phases.
 
## Structure

```
.claude/
├── WORKFLOW.md          # the flow: Frame → Build → Verify → Close
├── CONVENTIONS.md        # how skills/agents behave (feature state, when to ask, etc.)
├── review-contract.md    # the one PR-review rulebook
├── ROADMAP.md            # known gaps in this flow / the app
├── skills/                # /feature, /implement, /review-feature, /close-feature, /review-pr, /setup
└── agents/                # implementer · reviewer · installer

features/<slug>/feature.md  # per-feature state (one file)
scripts/                    # be-local · fe-local · check-env
Runbook.md                  # the real commands for both stacks
```

## First run

```
/setup                  # check the environment
/feature <name>          # frame a feature — walks you through Frame → Build → Verify → Close
```

Day-to-day commands (running the stacks, tests) live in [`../Runbook.md`](../Runbook.md).
