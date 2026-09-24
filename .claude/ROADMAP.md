# ROADMAP.md — twitter-clone workflow (deferred / open)

Short list of what this flow (and the app it governs) deliberately doesn't handle yet.

- **Auth is minimal.** Email + password with cookie sessions only: no password reset, no email
  verification, no per-account lockout beyond the 5/min/IP limit on sign-up/sign-in, and no
  `trust proxy` setting (behind a reverse proxy the throttler would bucket every client together).
- **No deploy pipeline.** Merging to `main` doesn't ship anything today. If that changes, update the
  "Merging" section of `WORKFLOW.md`.
