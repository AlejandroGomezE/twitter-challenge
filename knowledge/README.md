# knowledge/

Project knowledge base for twitter-clone: infrastructure, ops, and decisions that aren't
derivable from code or git history. Kept **out of `.claude/`** (the feature-workflow
definition) and **out of always-loaded context**.

## What belongs here

One self-contained doc per system/topic, with frontmatter and predictable section headings
(grep-friendly). The frontmatter convention:

```yaml
---
title: <short, specific title>
type: infra | decisions
summary: <1-3 sentences — what this doc is and why it exists>
status: active | superseded
last-verified: <ISO-date>
tags: [comma, separated, keywords]
---
```

Subfolders by `type`: `infra/` for systems and architecture decisions (currently
[[Backend architecture]], [[Frontend architecture]], [[Code quality]], and
[[UI component inventory]]), `decisions/` for a settled decision and its open
questions — the kind of record that keeps a decision from being re-litigated three
sessions later (currently [[Shadcn component preference]]).

There is no `legacy/` holding area for superseded docs — this is a solo, single-instance project,
so a doc that's genuinely superseded is corrected in place (or deleted) rather than archived.
