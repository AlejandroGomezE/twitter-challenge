# ROADMAP.md — twitter-clone workflow (deferred / open)

Short list of what this flow (and the app it governs) deliberately doesn't handle yet.

- **No auth module.** `backend/` has no guard/user model yet; `frontend/` has no `lib/auth/` or
  `ProtectedRoute`. See `knowledge/infra/code-quality.md`'s "Conventions for future modules" for the
  shape to build them in when a real requirement shows up.
- **No frontend test framework.** `frontend/` has no Jest/Vitest/Testing Library. Coverage today is
  the build + manual/browser verification. Don't ask for a frontend test in review until one's chosen.
- **No deploy pipeline.** Merging to `main` doesn't ship anything today. If that changes, update the
  "Merging" section of `WORKFLOW.md`.
