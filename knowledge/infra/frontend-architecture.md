---
title: Frontend architecture
type: infra
summary: Vite + React SPA (frontend/) structure and current implementation state — TanStack Query, shadcn/ui, react-router, HTTP client. No auth module or concrete features exist yet.
status: active
last-verified: 2026-09-24
tags: [frontend, react, vite, architecture, tanstack-query, shadcn]
---

## Structure

Organize by feature, once there are features to organize:

```text
frontend/src/
├── main.jsx
├── app/
│   ├── App.jsx
│   ├── router.jsx
│   └── providers.jsx
├── components/
│   ├── ui/           # shadcn/ui primitives — see [[UI component inventory]]
│   └── layout/        # not created yet — no shared layout shell exists
├── features/           # not created yet — no concrete feature exists
├── hooks/
├── lib/
│   ├── api/
│   ├── auth/           # not created yet — no auth module exists
│   └── validation/     # not created yet — no form exists yet
├── pages/
└── routes/             # not created yet — holds ProtectedRoute once auth exists
```

Each feature, once one exists, should follow:

```text
features/<name>/
├── api/
├── components/
├── hooks/
├── schemas/
└── pages/
```

Don't create these folders ahead of a real feature — an empty `features/auth/` or
`lib/auth/` is dead weight until there's something to put in it.

## HTTP client (`src/lib/api/client.js`)

Centralized `apiClient` (`get` / `post` / `patch` / `delete`) — no component calls
`fetch` directly. It:

- Reads `VITE_API_URL` (`frontend/.env`, defaults to `http://localhost:3000` if unset;
  Vite only exposes `VITE_`-prefixed vars to client code)
- Sets `Content-Type: application/json` and JSON-encodes request bodies
- Parses the response by its actual `content-type` (JSON vs. text) rather than
  assuming JSON
- Throws a single `ApiError` (status + message + body) on a non-2xx response, so every
  caller handles one error shape
- Has **no auth logic yet** — there's no token to attach. The extension point is
  commented directly in the file; wire a token in there once an auth module exists,
  not at individual call sites.

## TanStack Query

`QueryClientProvider` lives in `src/app/providers.jsx`, wrapping `<App>` in
`main.jsx` (alongside `<BrowserRouter>`). React Query Devtools mount in dev only
(`import.meta.env.DEV`). Use it for queries, mutations, cache invalidation,
loading/error states, and retries — don't hand-roll any of that with `useEffect` +
`useState`.

## Forms

`react-hook-form`, `zod`, and `@hookform/resolvers` are installed and ready. **No form
exists yet** — nothing to wire them into. When one lands: React Hook Form for form
state, Zod for the schema and validation messages, a resolver from
`@hookform/resolvers` to bridge the two.

## Routes

`src/app/router.jsx` holds the `<Routes>` tree (currently just `/` → `Home`).
`ProtectedRoute` doesn't exist yet — there's no auth module to gate on. See
[[Code quality]] for the expected `ProtectedRoute` shape and the route checklist to
build out once one does — that guidance lives there rather than here so it isn't lost
when this doc is re-verified against current state.

## Current state vs. this doc

**Implemented:** `app/` (`App.jsx`, `router.jsx`, `providers.jsx`), `components/ui/`
(shadcn, see [[UI component inventory]]), `hooks/`, `lib/api/client.js`, `lib/utils.js`,
`pages/Home.jsx` — a real `useQuery` call against the backend's `GET /`, used to prove
the whole chain (API client → TanStack Query → CORS → backend) actually works.

**Not implemented, intentionally:** `components/layout/`, `features/`, `lib/auth/`,
`lib/validation/`, `routes/` (and its `ProtectedRoute`). These follow once there's an
auth module and at least one concrete feature — see [[Backend architecture]] for why
auth isn't built yet either, and [[Code quality]] for the shape to build them in.
