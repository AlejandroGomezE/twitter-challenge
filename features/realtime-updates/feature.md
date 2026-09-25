---
slug: realtime-updates
status: verifying
scope: full-stack
next: /review-feature realtime-updates
---
# Realtime updates

Each signed-in browser tab opens one Server-Sent Events stream. Over it the server pushes four
kinds of change: new posts (shown as an "N new posts" pill on the timeline), notification changes
(the badge updates instantly), like/comment counts on posts, and deleted posts (removed from open
feeds). This builds on the domain events added by `notifications`.

## Plan
- Touched surface:
  - backend: new domain events in `src/common/events/domain-events.ts`, emitted from
    `PostsService` (create/delete), `CommentsService` (delete) and `NotificationsService`. A new
    `src/modules/realtime/` module containing a connection hub, a `GET /events` SSE controller,
    and listeners that turn domain events into stream messages.
  - frontend: a `RealtimeProvider` (one `EventSource`) mounted in the signed-in shell, plus event
    handlers that patch the TanStack Query caches through `lib/api/post-cache.js`. Also a new-posts
    pill in `pages/Home.jsx`, and the deleted state on `PostDetail`.
- Stream contract: `GET /events` (session cookie, `withCredentials`) returns `text/event-stream`.
  Each message has an `event:` name and a JSON `data:` body:
  - `post.created` `{ id, following: boolean }` goes to every connected user except the author.
    `following` is true when the recipient follows the author.
  - `post.deleted` `{ id }` goes to every connected user except the author.
  - `post.counts` `{ id, likeCount, commentCount }` goes to every connected user except the actor
    whose like/unlike/comment/comment-delete caused it.
  - `notifications.changed` `{ unreadCount }` goes only to the recipient, after a notification is
    created, retracted or marked read.
  - A `: ping` comment is sent every 25s. Each heartbeat also re-validates the session, and the
    stream closes when the session is no longer valid (after sign-out or expiry).
- Acceptance criteria:
  1. While B is on Home, a post by someone B follows shows a "1 new post" pill on Following and
     For you. A post by someone B doesn't follow shows it on For you only. B's own posts never
     count. Clicking the pill loads the new posts at the top, scrolls to the top and clears the
     pill. The list never shifts on its own.
  2. When a notification for B is created or retracted, B's badge updates within a second with no
     polling. If B is on `/notifications`, the new row appears at the top, and the read rows from
     the visit keep their highlight.
  3. When someone else likes, unlikes, comments or deletes a comment, the counts on that post
     update live wherever B sees it (feeds, profile, detail). B's own in-flight like toggle isn't
     overwritten.
  4. A post deleted by its author disappears from B's open feeds and profile lists. If B is on its
     detail page, B sees the existing not-found state. If the post was waiting behind the pill,
     the pill count goes down.
  5. The stream needs a session: `GET /events` without one returns 401. After sign-out, open
     streams for that session close within one heartbeat. The frontend reconnects with backoff
     while the user is signed in, and after a reconnect it refreshes the unread count. The 30s
     unread-count polling is off while the stream is connected, and focus refetch stays on as a
     fallback.
- Must not break: every existing endpoint, response and status code; optimistic create, delete
  and like flows (`useCreatePost`, `useDeletePost`, `useToggleLike`); notifications behavior; the
  e2e suite (which must not hang on an open stream).

## Tasks
- [x] (T1, be) New domain events: `post.created` `{ postId, authorId }` and `post.deleted` `{ postId, authorId }` from `PostsService`, `comment.removed` `{ actorId, postId, commentId }` from `CommentsService.delete`, and `notification.changed` `{ recipientId }` from `NotificationsService` after create, retract or mark-read (only when rows changed). All are fire-and-forget like the existing ones, with unit tests.
- [x] (T2, be) `src/modules/realtime/`: a `RealtimeHub` (in-memory connections per user, at most 5 streams per user with the oldest closed, cleanup on disconnect) and a `GET /events` `@Sse()` controller behind the session guard. It sends the 25s heartbeat that re-validates the session cookie and closes the stream when invalid. Unit tests.
- [x] (T3, be, after: T1, T2) Realtime listeners (`{ async: true }`, errors logged and never thrown) that map domain events to the stream contract. `following` is computed once per post from the author's followers intersected with connected users. Counts come from the posts service, and `unreadCount` from the notifications service. Unit tests.
- [x] (T4, fe) `RealtimeProvider`: one `EventSource(API_URL + '/events', { withCredentials: true })` mounted in the signed-in shell, with reconnect and backoff only while signed in, and a small subscribe API for handlers. `notifications.changed` sets the unread-count cache and invalidates the list, and a reconnect invalidates the unread count. `useUnreadNotificationCount` drops its `refetchInterval` while connected.
- [x] (T5, fe, after: T4) `post.counts` and `post.deleted` handlers built on `lib/api/post-cache.js`. Counts are patched without touching `likedByMe` and are skipped while that post has a like toggle in flight. A deleted post is removed from every list and its detail cache, so `PostDetail` shows its not-found state.
- [x] (T6, fe, after: T4) New-posts pill in `pages/Home.jsx`. It keeps pending post ids per tab (Following gets `following: true` only; For you gets all) and drops ids on `post.deleted`. Clicking it refetches that feed from the first page, scrolls to the top and clears the pending ids. It's accessible: a button whose name includes the count, and a polite live region announcing it.

## Decisions
- 2026-09-24 · framed · The transport is SSE, not WebSockets. Every push goes from server to client, it runs over plain HTTP with the existing cookie session and CORS `credentials`, `EventSource` reconnects on its own, and NestJS supports it natively with `@Sse()`. There is one multiplexed stream per tab rather than one per feature.
- 2026-09-24 · framed · New posts appear behind an "N new posts" pill rather than being inserted automatically, so the list never jumps under the reader (Alejandro).
- 2026-09-24 · framed · In scope: new posts, notifications, like/comment counts and deleted posts (Alejandro).
- 2026-09-24 · framed · The hub is in memory, which is enough for a single backend instance. Running more than one instance would need a shared pub/sub such as Redis to fan out events. That's documented, not built.
- 2026-09-24 · framed · The heartbeat re-validates the session instead of hooking into sign-out. That covers both sign-out and expiry, needs no change to the auth module, and never stores the session token beyond the request that opened the stream.
- 2026-09-24 · framed · Events aren't replayed. After a reconnect the client refreshes the unread count. Posts, counts and deletions missed while offline show up on the next normal refetch.
- 2026-09-24 · framed · The actor is excluded from `post.counts` and the author from `post.created`/`post.deleted`, because their own client already applied the change optimistically. This avoids fights with `useToggleLike`'s reconciliation.
- 2026-09-24 · framed · Notifications removed by an FK cascade (a post, comment or user deleted) emit no `notification.changed`, because the rows are gone before any listener runs. The badge corrects itself on the next focus refetch or reconnect. Accepted for v1.
- 2026-09-25 · building · The new-posts pill sits at the start of the feed list, below the composer, in a zero-height sticky wrapper. It no longer sits under the page header, where it covered the composer. It still takes no layout space, so the list never shifts, and it docks under the header when scrolled (Alejandro).

## Follow-ups
- [ ] Multi-instance fan-out (Redis pub/sub or similar) · out of scope, single instance.
- [ ] Live comment lists on an open post detail (new comments appear, not only the count) · not requested.
- [ ] Replay of events missed during a disconnect (`Last-Event-ID`) · out of scope by decision.
- [ ] Two backend tasks running `npm run test:e2e` at the same time conflict, because globalSetup recreates the shared `prisma/e2e.db` (seen as `SQLITE_READONLY_DBMOVED` and spurious failures). Consider a per-run DB file · process note, found during Build.
- [ ] `tsc --noEmit` (specs included) now also reports errors in `test/notifications.e2e-spec.ts`, on top of the known ones in `users.controller.spec.ts`, `comments.controller.spec.ts` and `follows.e2e-spec.ts`. `nest build` and vitest are unaffected · carried over from `notifications`.

## Log
- 2026-09-24 · framed
- 2026-09-25 · built — T1–T6 done: domain events → RealtimeHub + GET /events SSE (session-checked heartbeat) → listeners; frontend RealtimeProvider, live badge, live counts/deletions, new-posts pill (moved into the feed list per Alejandro). be 44 files/553 unit + 7 files/205 e2e, fe 51 files/590 tests, builds + lint green
