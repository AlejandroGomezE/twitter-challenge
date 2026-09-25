---
slug: follow-users
status: done
scope: full-stack
next: —
---
# Follow users

Follow / unfollow users (the follow-up left by `twitter-posts`), follower/following counts and lists
on profiles, a working "Following" feed tab, and the "Who to follow" card.

## Plan
- Touched surface:
  - `backend/prisma/schema.prisma` (new `Follow`), new `backend/src/modules/follows/`,
    `modules/users` (profile DTO counts), `modules/posts` (`PostsService.feedAuthorIds` — the
    documented extension point — plus a new "for you" listing, `feed.controller.ts`).
  - `frontend/src/lib/api/` + `hooks/` (follows, feeds), `pages/Profile.jsx`, `pages/Home.jsx`
    (`FeedTabs` becomes real tabs), `components/layout/RightRail.jsx`, new follow components.
  - Docs: Runbook, `knowledge/infra/backend-architecture.md`, `frontend-architecture.md`,
    `ui-component-inventory.md`.
- API contract (all behind the global AuthGuard; usernames case-insensitive, as today):
  - `PUT /users/:username/follow` / `DELETE /users/:username/follow` → `200 { following: boolean,
    followerCount: number }`. Idempotent (mirrors `PUT/DELETE /posts/:id/like`). 404 unknown user,
    400 following yourself. Per-user throttled like likes.
  - `GET /users/:username/followers` and `GET /users/:username/following` →
    `{ items: FollowUser[], nextCursor: string | null }`, most recent follow first, keyset paged with
    the same `?cursor=&limit=` rules as the other listings. 404 unknown user.
  - `GET /users/me/suggestions?limit=` (default 3, max 10) → `{ items: FollowUser[] }`: users the
    caller doesn't follow, excluding the caller, newest accounts first.
  - `FollowUser` = `{ username, bio, isFollowing, followsYou }` — the two booleans are relative to
    the caller (false for the caller's own row).
  - `GET /users/:username` (ProfileResponseDto) gains `followerCount`, `followingCount`,
    `isFollowing`, `followsYou`.
  - `GET /feed` = **Following**: posts by the caller + everyone they follow (response unchanged).
    New `GET /feed/for-you` = **For you**: every user's posts, newest first, same page shape.
- Acceptance criteria:
  1. On another user's profile, Follow / Following (hover → Unfollow) toggles the follow; counts
     update without a reload and survive one. No button on your own profile; "Follows you" shows
     when they follow you.
  2. Below "Joined …" a profile shows `N Following  M Followers`; clicking either opens a modal on
     that list (tabs to switch), infinite-scrolling, each row linking to that profile with a
     Follow / Follow back / Following button (none on your own row).
  3. Home has two working tabs: **Following** (you + people you follow, the default, with an empty
     state nudging you to follow someone) and **For you** (everyone's posts).
  4. The right rail's "Who to follow" lists up to 3 users you don't follow, each with a Follow
     button; following one updates the list and your counts.
- Must not break: existing feed paging/likes/comments caches, profile Posts tab, profile edit
  (username change must keep follows — they key on user id), fail-closed serialization (no id/email
  in any new response).

## Tasks
- [x] (T1, be) Prisma `Follow { followerId, followingId, createdAt }`: composite PK
  `(followerId, followingId)`, cascades on both users, indexes for "followers of X" and "following of
  X" ordered by `createdAt`; `db push` + `generate`.
- [x] (T2, be, after: T1) `modules/follows`: repository/service/controller for follow/unfollow,
  followers/following lists and suggestions, per the API contract; `FollowUser` response DTO through
  the fail-closed serializer; throttling. `UsersModule` and `PostsModule` will import this module, so
  it must not import either (resolve usernames in its own repository). Unit + e2e specs.
- [x] (T3, be, after: T2) Profile: add `followerCount`, `followingCount`, `isFollowing`, `followsYou`
  to `GET /users/:username` (and the counts to `MyProfileResponseDto`) without N+1 queries.
- [x] (T4, be, after: T2) Feeds: `feedAuthorIds` returns the caller + followed ids; add
  `GET /feed/for-you` (all authors) reusing the same keyset `page()`.
- [x] (T5, fe) API client + hooks: follow/unfollow mutation (optimistic, rolls back on error; updates
  the target's and the caller's profile counts, list rows and suggestions; invalidates the Following
  feed), infinite followers/following queries, suggestions query, For you feed query. Follow the
  existing `post-cache.js` / `writeAfterServerChange` race rules.
- [x] (T6, fe, after: T5) `FollowButton` (Follow / Follow back / Following → "Unfollow" on hover and
  focus, pending state) and the Profile page: counts row below "Joined", follow button, "Follows
  you" badge.
- [x] (T7, fe, after: T5, T6) `FollowListDialog`: shadcn Dialog with Following / Followers tabs,
  opened from the profile counts on the clicked tab; infinite list (`InfiniteListFooter`), rows with
  avatar, username, bio, profile link (closes the dialog) and `FollowButton`; loading/empty/error
  states.
- [x] (T8, fe, after: T5) Home: real For you / Following tabs (accessible tablist, selection kept in
  the URL `?tab=for-you`), Following default, Following empty state.
- [x] (T9, fe, after: T5, T6) RightRail "Who to follow": up to 3 suggestions with `FollowButton`,
  skeleton while loading, hidden when there are none.
- [x] (T10, fe, after: T2, T3, T4, T6, T7, T8, T9) Docs: Runbook endpoints, backend + frontend
  architecture, UI component inventory.
- [x] (T11, fe) Always-fresh profile counts: the Profile page refetches the profile every time it's
  shown (mount and `:username` change, even within the 30s `staleTime`), and each follow-list dialog
  tab refetches whenever it's opened; cached data stays on screen while refetching.

## Decisions
- 2026-09-24 · framed · Profiles are already viewable at `/u/:username` and post cards link there;
  "see a user's profile" means a follow button on profiles and profile links from every user row
  (Alejandro).
- 2026-09-24 · framed · **For you** = everyone's posts, newest first;
  **Following** = the caller + followed users, like Twitter, and is the **default tab** (Alejandro). `GET /feed` keeps the
  Following meaning because `feedAuthorIds` was built as its extension point; For you gets a new
  route.
- 2026-09-24 · framed · "Who to follow" is in scope: 3 non-followed users, newest accounts first — no
  ranking (Alejandro).
- 2026-09-24 · framed · Unfollow is one click on "Following" (it reads "Unfollow" on hover/focus);
  no confirm dialog — this list sits inside a modal already, and a follow is easy to redo.
- 2026-09-24 · framed · The suggestions route is `/users/me/suggestions`: `me` is a reserved
  username, so it can't clash with a real `/users/:username/...` path.
- 2026-09-24 · building · Follow/unfollow are throttled at 30/min per user per route
  (`FOLLOW_LIMIT_PER_MINUTE`). The plan said "like likes", but likes are deliberately unthrottled —
  kept a throttle since the plan asked for one. **Alejandro: keep 30/min** (2026-09-24).
- 2026-09-24 · building · New shared components `FollowButton` and `FollowListDialog` (compose
  existing shadcn `Button`/`Badge`/`Dialog`/`Tabs`) — **signed off by Alejandro** (2026-09-24)
  (`knowledge/decisions/shadcn-component-preference.md`). FollowButton stays clickable while a
  request is in flight (no spinner), like the like button; bursts settle on the last confirmed state.
- 2026-09-24 · building · Unfollowing from an open follow list keeps the row (now "Follow"), like
  Twitter: those lists are marked stale, not refetched. FollowListDialog has no end-of-list line.
- 2026-09-24 · building · Profile counts and follow lists always refetch when shown, so they
  never show stale followers/following (Alejandro).

## Follow-ups
- [x] (fixed at Close, `b7d68c8`) `follows/dto/follow-user-page-response.dto.ts` comment cites a non-existent
  `follow-user-page-response.dto.spec.ts`; the coverage lives in `follow-user-response.dto.spec.ts`.
- [x] (fixed 2026-09-24: down-be/down-fe now only kill the nest/vite dev tooling + its tree; a backend
  started otherwise is reported, not killed) `scripts/down-be` stops any backend from this repo on the port (it stopped a pre-existing
  `backend/dist/main` during Verify); the Runbook says foreign processes are only reported · flow
  tooling, not this feature.
- [x] (removed 2026-09-24, with their posts/follows/like/sessions) Verify seeded dev-DB users `va_f8zdd`, `vb2_f8zdd`, `vc_f8zdd` (+ posts/follows/like) · clean
  up if unwanted.
- [ ] Follow-list dialog opens with a visible focus ring on the selected tab (Radix autofocus) ·
  cosmetic.

## PRs
- https://github.com/AlejandroGomezE/twitter-challenge/pull/10

## Log
- 2026-09-24 · framed
- 2026-09-24 · built — follow/unfollow (idempotent, throttled), followers/following lists + dialog, profile counts + Follows you, Following (default) / For you feeds, Who to follow; docs. BE 29 suites / 334 unit + 4 suites / 137 e2e, FE 37 suites / 381, build/lint green.
- 2026-09-24 · built — T11: profile counts refetch every time a profile is shown (incl. on focus), follow-list tabs refetch on open/switch (not on focus/toggle), optimistic follows survive mid-flight refetches (target + own followingCount). BE 29 suites / 334 unit + 4 / 137 e2e, FE 37 suites / 391, build/lint green.
- 2026-09-24 · verified — all 4 ACs + T11 driven in headless Chrome + API (follow/unfollow/Follow back/Follows you, counts + dialog tabs/rows/nav, Following default vs For you feeds, Who to follow, fresh counts on return); likes, Posts tab, username change and 390px width intact
- 2026-09-24 · closed — PR #10, merged (Close: follow-cache unit tests, useProfile alwaysFresh tests, stale DTO comment fixed; review fix: removed unused followUser/unfollowUser exports)
