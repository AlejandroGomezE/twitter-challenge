---
title: Code quality
type: infra
summary: Alejandro's cross-project code-quality and architecture preferences — pragmatic layered design, explicit list of patterns to avoid, and what "tests" means per layer.
status: active
last-verified: 2026-09-24
tags: [code-quality, architecture, conventions, tests]
---

# Code quality

Configure:

* TypeScript strict mode
* ESLint
* Prettier
* Tests
* Import aliases
* Naming conventions
* Build scripts
* Lint scripts
* Test scripts

Avoid:

* `any`
* Extremely large files
* Controllers with business logic
* Services that access Prisma directly
* Repositories with business rules
* React components with complex API logic
* Circular dependencies
* Unnecessary base classes
* Hexagonal Architecture
* Clean Architecture
* CQRS
* Event Sourcing

I do not want:

* You to write function(arg: string | undefined) prefer function(arg?: string) instead
* Ports and adapters
* Separate use case classes
* Unnecessary repository interfaces
* Complex domain layers
* Injection tokens for every repository
* Excessive abstractions
* Microservices

I want a traditional, clear, and pragmatic architecture:

```text
Controller
Service
Repository
ORM
```

# Tests

Backend:

* Unit test for a service
* Mocked repository
* Controller test
* Authentication guard test
* Repository test when useful

Frontend:

* Component test
* Protected route test
* Form test
* API hook test

# Conventions for future modules

Shapes to reuse once these get built, so they aren't reinvented per-module or
re-litigated from scratch each session. None of this exists yet — see
[[Backend architecture]] / [[Frontend architecture]] for current state.

## Backend — `common/` taxonomy

Only `common/filters/` exists today (`all-exceptions.filter.ts`). When something
cross-cutting is actually needed, this is where it goes — don't invent a different
home for it:

* `decorators/` — custom param/method decorators (e.g. a future `@CurrentUser()`)
* `exceptions/` — custom domain exceptions (thrown by services, caught by the global
  filter)
* `filters/` — exception filters
* `guards/` — auth/permission guards
* `interceptors/` — response shaping, logging, etc.
* `pipes/` — custom validation/transformation pipes

## Backend — auth module shape (provider not decided yet)

```text
auth/
├── auth.module.ts
├── auth.service.ts
├── auth.guard.ts
├── authenticated-user.interface.ts
└── current-user.decorator.ts
```

Prefer a single global guard (`APP_GUARD`) protecting every route by default, with an
explicit `@Public()` decorator to opt individual routes out — don't gate routes
one-by-one with per-controller guards. Which auth provider (Firebase, Clerk, roll your
own JWT, etc.) is an open decision — don't assume one when this actually gets built.

## Backend — generic domain module shape

```text
modules/<name>/
├── dto/
├── entities/
├── <name>.controller.ts
├── <name>.service.ts
├── <name>.repository.ts
└── <name>.module.ts
```

This is the same Controller → Service → Repository → ORM shape from above, just
spelled out per-file for the first real module to copy.

## Frontend — auth context shape

```typescript
interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  getAccessToken(): Promise<string | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
```

Expose it through a `useAuth()` hook — components and `ProtectedRoute` consume the
hook, never the context directly. `apiClient` (see [[Frontend architecture]]) attaches
the token via `getAccessToken()` once this exists.

## Frontend — routes checklist

For when there's more than one page:

* Public routes
* Protected routes (via `ProtectedRoute`, gated on `useAuth()`)
* Login
* Main authenticated view (e.g. the feed/timeline)
* Profile
* 404 page
* Error boundary

# Current tooling (twitter-clone)

How the "Configure" list above maps onto the actual two apps — see
[[Backend architecture]] and [[Frontend architecture]] for the full picture:

* **TypeScript strict mode** — `backend/` only (`tsconfig.json`: `strict: true`).
  `frontend/` is plain JS (no TypeScript), with `jsconfig.json` providing the `@/*`
  import alias instead.
* **Lint** — `backend/` uses `oxlint` (`npm run lint`), not ESLint; `frontend/` uses
  ESLint (`npm run lint`). `backend/oxlint.json` currently sets
  `@typescript-eslint/no-explicit-any` to `"off"`, which sits at odds with "Avoid:
  `any`" above — noted, not silently changed; see [[Backend architecture]]'s open
  questions.
* **Import aliases** — `@/*` → `frontend/src/*` (both `frontend/vite.config.js` and
  `frontend/jsconfig.json`). No alias configured on the backend yet (relative imports
  only).
* **Tests** — backend: Vitest (`npm test`, `test:cov`, `test:e2e`). Frontend: Vitest
  + jsdom + React Testing Library + MSW (`npm test`, `test:watch`, `test:cov`) —
  colocated `*.test.jsx`, API faked with MSW handlers, never by mocking `apiClient`.
