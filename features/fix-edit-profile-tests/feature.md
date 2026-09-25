---
slug: fix-edit-profile-tests
status: done
scope: frontend
next: —
---
# Fix EditProfile test race

`src/pages/__tests__/EditProfile.test.jsx` fails 1–4 of its 24 tests per run, differently each run,
and it passes when a failing test runs alone. This was diagnosed during `realtime-updates` Close:

1. After "Save", `EditProfile` seeds the saved profile into the cache and navigates to `/u/<username>`.
2. `Profile.jsx` uses `useProfile(username, { alwaysFresh: true })` (added in `follow-users`), which
   uses `staleTime: 0`, so it refetches `GET /users/<username>` on mount (seen about 4ms after the PATCH).
3. The test's `mockProfiles` serves a fixed profile that never reflects the PATCH, so the refetch
   puts the old data back.
4. An assertion passes only if `findBy…` sees the saved data in the few milliseconds before that
   overwrite, so the result depends on timing.

A real API returns the saved profile on that refetch, so the app itself is correct. The mock is
wrong. Separately, the rename test ("no stale username cached") may be showing a real leak: the
`ada` profile query may be recreated after `removeQueries` because `EditProfile`'s own
`useProfile('ada')` observer is still mounted at that moment.

## Plan
- Touched surface: `frontend/src/pages/__tests__/EditProfile.test.jsx`, which gets a mock that
  keeps state. `frontend/src/pages/EditProfile.jsx` changes only if the rename leak turns out to be real.
- Acceptance criteria:
  1. The mocked API keeps state like the real one: after a successful `PATCH /users/me`,
     `GET /users/:username` returns the saved profile, under the new username when it changed, and
     the old username returns 404 after a rename.
  2. The rename case is settled with evidence. If `profileQueryKey(<old>)` really comes back in the
     cache after a rename, it's fixed in `EditProfile.jsx` (for example, the old entry is removed
     only once the edit page no longer observes it) and a test pins that down. If it doesn't, the
     test waits for the real end state instead of racing.
  3. `EditProfile.test.jsx` passes 10 times in a row on its own and in 3 consecutive full
     `npm test` runs. `npm run build` and `npm run lint` pass.
  4. It isn't "fixed" by making the tests slower or looser: no longer `waitFor`/`findBy` timeouts,
     no retries, no removed or weakened assertions, and every existing test keeps its intent.
- Must not break: `alwaysFresh` on the profile page, which is intentional, and the edit flows the
  tests already cover (no-op save, trimming, rename, name/bio, validation errors).

## Tasks
- [x] (T1, fe) Make `EditProfile.test.jsx`'s API mock keep state: `mockPatch` updates the profiles that `mockProfiles` serves, including moving the entry on a rename, and the default handler echoes the saved profile. Then prove the race is gone with 10 consecutive runs of the file and 3 full-suite runs.
- [x] (T2, fe, after: T1) Settle the rename "no stale username cached" case. Instrument it to show whether `profileQueryKey('ada')` is recreated after `removeQueries`, and by which observer. If the leak is real, fix it in `EditProfile.jsx` without changing any visible behavior; if not, make the test assert the end state properly. Report the evidence either way.

## Decisions
- 2026-09-25 · framed · Fix the test mock, not the app. The profile page's `alwaysFresh` refetch is intentional, and a real server returns the saved data, so only the mock was modelling the API wrongly. This is a separate PR from `realtime-updates`, as Alejandro chose.
- 2026-09-25 · building · The rename leak was real. During `navigate()` in `onSuccess`, the right rail's `ProfileCard` re-rendered with the stale `me.username`, because TanStack's notifyManager delivers the new `me` on `setTimeout(0)`. That re-created the just-removed `ada` query, which fetched and returned 404. Fix: `removeQueryOnceUnobserved` in `EditProfile.jsx` removes the old entry once nothing observes it, using public QueryCache events only.

## Follow-ups

## PRs
- #14 · https://github.com/AlejandroGomezE/twitter-challenge/pull/14

## Log
- 2026-09-25 · framed
- 2026-09-25 · built — stateful test mock (T1) + rename stale-cache fix with a pinning test (T2). EditProfile 25/25 on 5 extra consecutive runs; full suite 52 files / 607 tests green twice; build + lint green
- 2026-09-25 · verified — EditProfile 25/25 ×10 and full suite 52 files/607 ×3; real-app renames bo14090→bo14090x→bo14090 never requested the old username and had no 404s; approved by Alejandro
- 2026-09-25 · closed — PR #14, merged
