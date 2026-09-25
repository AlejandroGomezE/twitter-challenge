---
slug: notifications
status: verifying
scope: full-stack
next: /close-feature notifications
---
# Notifications

The signed-in user is notified when someone follows them, likes one of their posts, or comments on
one of their posts. The disabled "Coming soon" Notifications item in the nav turns into a real page
with an unread badge. Live push over SSE is out of scope: it becomes its own feature
(`realtime-updates`). For now the badge refreshes on window focus and on an interval.

## Plan
- Touched surface:
  - backend: a new `Notification` model in `prisma/schema.prisma`, a new
    `src/modules/notifications/` module, and small emit points in `posts.service.ts` (like/unlike),
    `comments.service.ts` (create) and `follows.service.ts` (follow/unfollow). The like and follow
    repository inserts must report whether a row was actually inserted. Adds `@nestjs/event-emitter`.
  - frontend: `lib/api/notifications.js`, `hooks/use-notifications.js`, `pages/Notifications.jsx`,
    a `/notifications` route in `app/router.jsx`, and changes to `nav-items.js` plus
    `SideNav`/`MobileNav` for the badge.
- Data model: `Notification { id, recipientId, actorId, type ('follow' | 'like' | 'comment'),
  postId?, commentId?, readAt?, createdAt }`. It has FKs to `User` (recipient and actor), `Post` and
  `Comment`, all `onDelete: Cascade`, and `@@index([recipientId, createdAt])`. `type` is a `String`
  validated in code.
- API (all behind the session guard, and always scoped to the session user):
  - `GET /notifications?cursor&limit` → `{ items: NotificationView[], nextCursor: string | null }`.
    Newest first, keyset paging via `modules/posts/pagination.ts`.
    `NotificationView = { id, type: 'follow' | 'like' | 'comment', createdAt, read: boolean,
    actor: { username, displayName }, post: { id, body } | null, comment: { id, body } | null }`
  - `GET /notifications/unread-count` → `{ count: number }`
  - `POST /notifications/read` with body `{ until: <ISO createdAt> }` → `204`. Marks the session
    user's unread notifications with `createdAt <= until` as read.
- Acceptance criteria:
  1. When B follows A, likes A's post, or comments on A's post, A gets exactly one notification for
     that action. Acting on your own post creates nothing.
  2. Repeating a like or follow that already exists (idempotent `PUT`) doesn't create a duplicate.
     Unliking or unfollowing removes that notification. Deleting the comment, the post, or either
     user removes it through the cascade.
  3. The Notifications nav item links to `/notifications` and shows the unread count (hidden at 0)
     in both the side nav and the mobile bar.
  4. `/notifications` lists notifications newest first with infinite scroll. Each row shows an icon
     per type, the actor linked to their profile, the text ("followed you" / "liked your post" /
     "commented on your post"), a snippet of the post or comment linking to
     `/u/<me>/posts/<postId>`, and a relative time. Rows that were unread are highlighted for this
     visit, and the list has an empty state.
  5. Opening the page marks everything up to the newest item shown as read, and the badge clears.
     A notification that arrives after the page loaded stays unread.
- Must not break: like/unlike, follow/unfollow and comment responses and status codes, including
  their idempotency and 404 races. If creating the notification fails, the originating request
  must still succeed.

## Tasks
- [x] (T1, be) Add the `Notification` model to the schema and add `@nestjs/event-emitter` (`EventEmitterModule.forRoot()` in `app.module.ts`). Make `PostsRepository.like` and `FollowsRepository.follow` return whether a row was inserted. — done
- [x] (T2, be, after: T1) Emit domain events after successful writes: `like.created` / `like.removed` from `PostsService.setLiked` (created only if a row was actually inserted), `follow.created` / `follow.removed` from `FollowsService.setFollowing` (same rule), and `comment.created` from `CommentsService.create`. Payloads carry actor, recipient and ids.
- [x] (T3, be, after: T1, T2) `NotificationsModule`: event listeners that create or retract notifications (skipping self-actions, logging failures instead of throwing), plus a repository, service and controller for the three endpoints above.
- [x] (T4, fe) `lib/api/notifications.js` and `hooks/use-notifications.js`: an infinite list query, an unread-count query (`refetchOnWindowFocus` plus a 30s `refetchInterval`), and a mark-read mutation that invalidates the unread count.
- [x] (T5, fe, after: T4) Unread badge on the Notifications nav item: `nav-items.js` gets a `to`, and `SideNav`/`MobileNav` render the count.
- [x] (T6, fe, after: T4) `pages/Notifications.jsx` and the `/notifications` route. Rows, empty/loading/error states, mark-read after the first page loads, and unread highlighting taken from the loaded data.

## Decisions
- 2026-09-24 · framed · Scope is REST only. SSE live push is a separate `realtime-updates` feature (Alejandro).
- 2026-09-24 · framed · Triggers are new follower, like on your post, and comment on your post (Alejandro).
- 2026-09-24 · framed · One row per event, with no "A and 3 others" grouping. Grouping is a follow-up (Alejandro).
- 2026-09-24 · framed · Opening the page marks everything read, Twitter-style. `readAt` is per row so the rows that were unread stay highlighted for that visit (Alejandro).
- 2026-09-24 · framed · Notifications are created by `@nestjs/event-emitter` listeners, not called inline from posts/follows/comments. Those modules stay unaware of notifications, and the same events can later feed SSE.
- 2026-09-24 · framed · Unlike and unfollow retract the notification. A notification is only created when a like or follow row was really inserted, so repeated `PUT`s don't spam. Deleting a comment retracts through the FK cascade.
- 2026-09-24 · framed · Mark-read takes `until` (the newest `createdAt` the client has seen), so a notification that arrives while the page is open isn't marked read unseen.
- 2026-09-24 · framed · Self-actions (liking or commenting on your own post) never notify.

## Follow-ups
- [ ] Live push over SSE (`realtime-updates` feature) · out of scope by decision.
- [ ] Group repeated events ("A and 3 others liked your post") · out of scope by decision.
- [ ] Like → unlike → like creates a fresh notification each cycle. Consider a cooldown if it becomes spammy · edge case, not worth the complexity in v1.
- [ ] Close: make the `AppShell.test.jsx` "no badge when the count cannot be loaded" test wait for the failed request to finish. Right now it passes while the count is still loading, so it doesn't test the error path · T5 reviewer, test quality.
- [ ] Coming back to `/notifications` within the 30s `staleTime` shows the cached rows, which still say `read: false`. They're highlighted again and a harmless mark-read is sent again. Possible fix: flip the cached rows to read in `useMarkNotificationsRead`'s `onSuccess` via `setQueryData`, since `useUnreadThisVisit` already keeps the highlight for the current visit · cosmetic, T6 reviewer said it can wait.
- [ ] `EditProfile.test.jsx` fails intermittently (1–3 tests, e.g. "sends bio \"\" when the bio is cleared"). It also fails with this feature's files removed · pre-existing, unrelated.
- [ ] `tsc -p tsconfig.json` reports 16 type errors in `follows.controller.spec.ts` / `comments.controller.spec.ts` (`displayName` missing on `PublicUser` fixtures). `nest build` and vitest are unaffected · pre-existing, unrelated.
- [ ] `scripts/be-local`, `scripts/fe-local` and `scripts/check-env` are committed without the executable bit (mode `100644`, while `down-be`/`down-fe` are `100755`). On a fresh clone `scripts/be-local` fails with "permission denied", which contradicts the Runbook. Fix: `git update-index --chmod=+x` · found during Verify, unrelated to this feature.

## Log
- 2026-09-24 · framed
- 2026-09-24 · built — T1–T6 done: events → listener → Notification rows, 3 endpoints, nav badge, /notifications page. be 41 files/494 tests, fe 46 files/539 tests, builds + lint green
- 2026-09-24 · verified — all 5 ACs pass on the running app: 32/32 API checks (3 users) + headless Chromium at 1440/800/390px (badge, list, highlight, mark-read, empty, error+Retry); approved by Alejandro
