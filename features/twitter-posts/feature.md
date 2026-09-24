---
slug: twitter-posts
status: verifying
scope: full-stack
next: /review-feature twitter-posts
---
# Posts: create, delete, feed, profile posts, likes, post detail + comments

## Plan
- Touched surface:
  - `backend/prisma/schema.prisma` — new `Post`, `Like`, `Comment` models (additive: a plain
    `prisma db push`, no reset).
  - `backend/src/modules/posts/` — repository, service, controller, DTOs (request + response),
    cursor pagination helper; likes and comments live in this module.
  - `backend/src/modules/users/` — `ProfileResponseDto` gains `postCount`; `GET /users/:username/posts`.
  - `backend/test/app.e2e-spec.ts`.
  - `frontend/src/components/feed/` — `PostCard` (ported from Pulse's `post-card.tsx`), `Composer`
    (enabled), `CommentComposer`, `CommentItem`, infinite-list helper; `src/lib/api/posts.js` +
    hooks; `pages/Home.jsx`, `pages/Profile.jsx`, new `pages/PostDetail.jsx`, `app/router.jsx`,
    `components/layout/*` ("New post" buttons).
  - Docs: Runbook, backend/frontend architecture, UI component inventory.
- Data model (cascades: deleting a post removes its likes and comments; deleting a user removes
  theirs):
  - `Post { id cuid, authorId, body, createdAt }`, `@@index([authorId, createdAt])`.
  - `Like { userId, postId, createdAt }`, `@@id([userId, postId])` (one like per user per post),
    `@@index([postId])`.
  - `Comment { id cuid, postId, authorId, body, createdAt }`, `@@index([postId, createdAt])`.
- API (all auth-gated, all bodies through response DTOs; writes use the id from the session only):
  - `POST /posts` `{ body }` → 201 `Post`.
  - `GET /posts/:id` → 200 `Post` / 404.
  - `DELETE /posts/:id` → 204; 403 if not yours; 404 if missing.
  - `GET /feed?cursor=` → page of `Post`, newest first: your posts + posts by users you follow.
    Follows don't exist yet (next feature), so today that's your own posts; the service builds the
    author set in one place the follows feature will extend.
  - `GET /users/:username/posts?cursor=` → that user's posts, newest first (404 unknown user).
  - `PUT /posts/:id/like` → 200 `{ liked: true, likeCount }` (idempotent); `DELETE /posts/:id/like` →
    200 `{ liked: false, likeCount }` (idempotent); 404 if the post is missing.
  - `GET /posts/:id/comments?cursor=` → page of `Comment`, oldest first.
  - `POST /posts/:id/comments` `{ body }` → 201 `Comment`; `DELETE /posts/:id/comments/:commentId` →
    204; 403 if not yours; 404 if missing.
  - `Post` = `{ id, body, createdAt, author: { username }, likeCount, commentCount, likedByMe }`;
    `Comment` = `{ id, body, createdAt, author: { username } }`; page = `{ items, nextCursor }`
    (`nextCursor` null at the end). `GET /users/:username` gains `postCount`.
- Rules:
  - Post and comment bodies: trimmed, 1–280 characters counted as Unicode code points (so an emoji
    counts as 1), not blank. Same count on the frontend counter.
  - Pagination: opaque cursor over `(createdAt, id)` so equal timestamps never skip/duplicate; page
    size 20 (max 50).
  - Rate limits (same `ThrottlerGuard` pattern as auth): create post 10/min, create comment 20/min
    per user.
  - Bodies are rendered as plain text (never HTML), line breaks kept.
- Acceptance criteria:
  1. Create: the composer is enabled; typing shows a live `N/280` counter (code points); Post is
     disabled when blank or over 280; Cmd/Ctrl+Enter posts; the new post appears at the top of the
     feed and on your profile without a reload; server errors (400/429) show in the composer.
  2. Delete: your own posts have a "…" menu with Delete behind a confirmation dialog; deleting removes
     it from the feed, your profile and (if open) its detail page, which then goes back. Other
     people's posts have no Delete; the API refuses (403) anyway.
  3. Feed (`/`, "For you"): your posts (+ followed users' once follows exist), newest first,
     infinite scroll (loads the next page near the bottom, with a "Load more" fallback button),
     loading / empty / error states, "You're all caught up" at the end. "Following" tab stays disabled.
  4. Profile (`/u/:username`): the Posts tab lists that user's posts, newest first, same paging;
     the header shows the real post count.
  5. Likes: a heart toggle with the like count on every post card and the detail page; optimistic
     update that rolls back on error; state persists across reloads; `likedByMe` per viewer.
  6. Detail: clicking a post (not its buttons/links) opens `/u/:username/posts/:id` in the center
     column (shell stays), showing the post, its likes, a comment composer and the comments (oldest
     first, paged). Wrong username in the URL redirects to the canonical one; unknown id → "Post not
     found". The comment count on cards is real.
  7. Comments: any signed-in user can comment (1–280, same rules); you can delete your own comments
     (confirmation); counts update without a reload.
  8. "New post" (left rail) and the mobile compose button are enabled: they go to Home and focus the
     composer.
- Must not break: auth/profile behaviour and tests; fail-closed serialization (every new handler
  declares its response DTO); the shell's disabled items other than "New post"; e2e runs on
  `e2e.db`.

## Tasks
- [x] Prisma: `Post`, `Like`, `Comment` with indexes and cascades; `db push` (dev) + `generate`.
- [x] Backend posts core: `modules/posts` repository/service/controller; create, get, delete (own
  only); body rules (code-point length); cursor helper; response DTOs (nested author) through the
  fail-closed serializer; post throttling.
- [x] Backend listings: `GET /feed` (author set = me + followed, one extension point), `GET
  /users/:username/posts`, `postCount` on the profile response; `likeCount`/`commentCount`/
  `likedByMe` computed without N+1 queries.
- [x] Backend likes: idempotent like/unlike endpoints returning `{ liked, likeCount }`.
- [x] Backend comments: list (oldest first, paged), create (throttled), delete own.
- [x] Backend e2e: every endpoint and rule above (incl. 403s, pagination boundaries, idempotency,
  cascades, code-point length).
- [x] Frontend data layer + PostCard: `lib/api/posts.js` + hooks (infinite queries, mutations with
  cache updates, optimistic like), `PostCard` (Pulse layout: avatar, @username → profile, relative
  time, body, action row: comments → detail, like toggle + count; repost/bookmark/share disabled
  "Coming soon"; own-post "…" menu → Delete with `AlertDialog`), whole card clickable to detail.
- [x] Frontend feed + composer: enable `Composer` (counter, validation, submit, errors, shortcut),
  Home feed with infinite scroll + "Load more" + states; "New post" buttons → Home + focus composer.
- [x] Frontend profile posts + detail: Profile Posts tab + post count; `PostDetail` page (post,
  comment composer, comments list, delete own comment), canonical-URL redirect, not-found; router.
- [x] Docs: Runbook (endpoints, rules), backend + frontend architecture, UI inventory.

## Decisions
- 2026-09-24 · framed · Feed = your posts + followed users' posts (Alejandro). No follows yet, so
  it currently shows only your own posts; the author set is built in one place for the follows
  feature to extend — no throwaway global timeline.
- 2026-09-24 · framed · Post detail URL `/u/:username/posts/:id` (Alejandro), looked up by id; a
  wrong username redirects to the canonical one.
- 2026-09-24 · framed · Comments are flat, 280 chars, oldest first, and deletable by their author
  (Alejandro). No nested replies, no comment likes.
- 2026-09-24 · framed · Infinite scroll with cursor pagination and a "Load more" fallback
  (Alejandro); same pattern for the profile Posts tab and comments.
- 2026-09-24 · framed · Profiles list any user's posts (not only your own) — the profile page already
  shows other users, and "your own posts" is the special case of it.
- 2026-09-24 · framed · "Chronological" = newest first for feed and profile (Twitter's timeline);
  comments read oldest first like a conversation.
- 2026-09-24 · framed · 280 counted in Unicode code points on both sides; bodies trimmed, blank
  rejected. Deleting a post hard-deletes it with its likes and comments (no soft delete).
- 2026-09-24 · framed · New tables are additive: plain `npx prisma db push` in `backend/` after
  pulling — no dev-DB reset this time.
- 2026-09-24 · framed · Rate limits on writes (posts 10/min, comments 20/min per user) reuse the
  throttler pattern from auth; likes aren't throttled (idempotent, cheap).
- 2026-09-24 · building · `Post` also has `@@index([createdAt])`: unused while the feed's author set
  is just you, but it lets SQLite walk time order once follows make the author list large.
  `Comment.authorId` is deliberately unindexed (no query filters by it; only a user-delete cascade
  scans it).
- 2026-09-24 · building · Throttling: one global ThrottlerModule with two named throttlers
  (`src/auth/throttlers.ts`) — `auth` (5/min per IP, only when there's no session user, i.e. the
  @Public sign-in/up routes; AuthGuard never sets `req.user` there, so a signed-in caller can't skip
  it) and `user` (keyed `user:<id>`, per-route limits via `@Throttle`). Rejected (400) requests count.
- 2026-09-24 · building · Nested response DTOs need `@Type(() => …)`: without it
  `excludeExtraneousValues` copies the nested object whole (the author's email/passwordHash leaked in
  a probe). Guarded by `posts/dto/__tests__/post-response.dto.spec.ts` through the real interceptor.
- 2026-09-24 · building · The Pulse prototype (`temp/`) was removed from disk after the UI migration;
  PostCard follows this spec and the already-ported Pulse styling.
- 2026-09-24 · building · The feed's author set lives only in `PostsService.feedAuthorIds(viewerId)`
  (`[viewerId]` today) — the follows feature extends it there. `GET /users/:username/posts` is owned by
  `UsersController`; `UsersModule` → `PostsModule` one way (no cycle). An empty `cursor=` is a 400: the
  frontend omits the param for the first page.
- 2026-09-24 · building · Cache races: every write after a server change goes through
  `writeAfterServerChange` (cancel in-flight fetches of the touched queries → write → restart cancelled
  first loads); optimistic likes cancel loaded fetches first. Like bursts roll back to the last
  server-confirmed state by click order. Trade-off: an in-flight "load more" is cancelled by a write
  and re-requested on the next scroll. Keyboard "open post" = the timestamp link; the card click is a
  mouse shortcut. Close: tests for the first-load restart branch and the comment write paths.
- 2026-09-24 · building · Composer counts the trimmed body in code points (matches the backend),
  no `maxLength` (UTF-16) so over-limit is visible; textarea `readOnly` while posting; Cmd/Ctrl+Enter
  ignored during IME composition. `InfiniteListFooter` arms its IntersectionObserver only while the
  query is idle, unobserves on fire and re-observes when `fetchNextPage` resolves — so a background
  refetch can't stall scroll-loading. "New post" → Home via `state.focusComposer`. Like bursts are
  reset on sign-out.
- 2026-09-24 · building · PostDetail's Back only goes back when the app itself pushed the entry
  behind it (`lib/navigation-history.js` + `NavigationDepthTracker`: PUSH +1, REPLACE same, POP keeps,
  unknown → 0); otherwise it goes to the author's profile. Redirects (sign-in return, canonical URL)
  can never make Back leave the app; after a reload it conservatively goes to the profile.
- 2026-09-24 · building · A reply posted while older comment pages aren't loaded shows "Reply posted.
  Load more comments to see it." (the cache only appends when the list is fully loaded).
- 2026-09-24 · building · New shared components outside the plan: `CharacterCounter`,
  `PostListSkeleton` — sign-off **pending Alejandro**. Close: tighten the navigation-history
  idempotency test (it can't currently distinguish depth 1 from 2).

## Follow-ups
- [ ] **Follows (next feature):** follow/unfollow, add followed authors to the feed's author set,
  enable the "Following" tab and "Who to follow", follower/following counts.
- [ ] Reposts, bookmarks and share on post cards stay disabled ("Coming soon").
- [ ] (open, app-wide — Alejandro to decide) The global `ValidationPipe` has
  `enableImplicitConversion`, so a JSON number in a string field is coerced before `@IsString()` runs
  (`POST /posts { body: 123 }` → 201 with body "123"). Affects every DTO. Either drop implicit
  conversion (and add explicit `@Type(() => Number)` where query numbers need it) or accept it.

## Log
- 2026-09-24 · framed
- 2026-09-24 · built — posts (create/delete own, 280 code points), feed (you + followed, keyset
  pagination, infinite scroll), profile posts + postCount, likes (idempotent, optimistic, race-safe),
  post detail + flat comments; per-user rate limits; docs. BE 24 suites / 254 unit + 92 e2e,
  FE 30 suites / 315, build/lint/tsc green.
