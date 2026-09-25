---
slug: user-search
status: framed
scope: full-stack
next: /implement user-search
---
# User search (with display names)

Users get an optional **display name**, shown wherever a user appears. Search finds users by display
name or username: a typeahead dropdown under the right-rail search box, plus a full results page on
**Explore** (so phones can search too). The rail search box's focus outline is no longer clipped.

## Plan
- Touched surface:
  - `backend/prisma/schema.prisma` (`User.displayName`), `modules/users` (PATCH /users/me, profile
    DTOs, new search endpoint), `modules/posts` (post/comment author DTO), `modules/follows`
    (`FollowUser` DTO).
  - `frontend/src/lib/validation/profile-schemas.js`, `pages/EditProfile.jsx`, `pages/Profile.jsx`,
    `components/feed/PostCard.jsx` + `CommentItem.jsx`, `components/FollowListDialog.jsx`,
    `components/layout/RightRail.jsx` (profile card, Who to follow, search box), new Explore page,
    `nav-items.js`, `app/router.jsx`, new search API/hooks.
  - Docs: Runbook, backend/frontend architecture, UI component inventory.
- API contract (all behind the global AuthGuard):
  - `User.displayName`: optional string, trimmed, 1–50 characters (code points), no line breaks;
    `null` when unset.
  - `PATCH /users/me` accepts `displayName` (`''` clears it, like `bio`).
  - `displayName` (`string | null`) is added to: `GET /users/:username`, `PATCH /users/me`, the post
    and comment `author` object (`{ username, displayName }`), and every `FollowUser` item (followers,
    following, suggestions).
  - `GET /search/users?q=&cursor=&limit=` → `{ items: FollowUser[], nextCursor: string | null }`.
    - `q`: trimmed, a leading `@` stripped, 1–50 characters after that; otherwise 400.
    - Matches users whose username **or** display name contains `q`, case-insensitive. The caller is
      included if they match; their row has no follow booleans set (both false).
    - Ordered by username ascending, keyset-paged on username; `limit` 1–50, default 20.
    - `FollowUser` = `{ username, displayName, bio, isFollowing, followsYou }`.
- Acceptance criteria:
  1. In Edit profile you can set, change and clear a display name (max 50, counted like the backend);
     it saves and persists.
  2. When set, the display name shows (bold) with the @username (muted) on the profile header, post
     cards and comments, follower/following rows, Who to follow and the rail profile card; when not
     set, those places look as they do today.
  3. Typing in the right-rail search box shows up to 5 matching users (by display name or username)
     in a dropdown after a short pause; arrow keys + Enter open a user, Enter on the query (or "See
     all results") goes to Explore; Escape or clicking away closes it.
  4. Explore (`/explore?q=…`, enabled in the side and bottom nav) has its own search box and lists
     all matches with infinite scroll, each row linking to the profile with a Follow / Follow back /
     Following button (none on your own row); it has states for no query, no results, loading and
     errors.
  5. When the rail search box is focused, its whole focus outline is visible — nothing is clipped.
- Must not break: username rules and profile edit, follow buttons/counts and caches, post/comment
  rendering and likes, fail-closed serialization (no id/email in any response).

## Tasks
- [ ] (T1, be) Prisma `User.displayName String?` + `db push`/`generate`. Users module: display-name
  rules (shared constants, like the username/bio rules), `PATCH /users/me` accepts it (`''` clears),
  `ProfileResponseDto` + `MyProfileResponseDto` expose it. Unit + e2e specs.
- [ ] (T2, be, after: T1) Expose `displayName` in the post/comment author DTO (`posts` module) and in
  `FollowUserResponseDto` (`follows` module), without extra queries per row. Update specs.
- [ ] (T3, be, after: T1, T2) `GET /search/users` per the contract, in its own controller
  (`@Controller('search')`), reusing the follows relation batch lookup and `pagination.ts`; query DTO
  with `@Type` for `limit`. Unit + e2e specs (matching on each field, case-insensitivity, `@` strip,
  paging, 400s, no id/email).
- [ ] (T4, fe) Display names in the UI: `displayName` rule in `profile-schemas.js`, Edit profile
  field, and a small shared name component (display name + @username, falling back to @username)
  used on the profile header, PostCard, CommentItem, FollowListDialog rows, and the RightRail
  profile card + Who to follow rows. Tests.
- [ ] (T5, fe) Search data layer: `lib/api` function + query keys and `hooks/use-user-search.js`
  (debounced typeahead query, limit 5; infinite query for Explore); disabled for an empty query; MSW
  default handler for `/search/users`. Tests.
- [ ] (T6, fe, after: T4, T5) RightRail search box becomes a working combobox typeahead (the
  "Coming soon" wrapper goes), with a dropdown of up to 5 users, keyboard navigation, "See all
  results" → `/explore?q=`, closing on Escape and click-away. Fix the clipped focus outline (the rail
  is an `overflow-y-auto` container that cuts off the input's 3px ring; e.g. give the rail inline
  padding or inset the ring). Tests.
- [ ] (T7, fe, after: T4, T5) Explore page at `/explore` (`?q=` in the URL, replaced while typing):
  search input, infinite results list with `FollowButton` rows, states for no query, no results,
  loading and errors; route in `router.jsx`; Explore enabled in `nav-items.js` (desktop + mobile).
  Tests.
- [ ] (T8, fe, after: T1, T2, T3, T4, T6, T7) Docs: Runbook endpoints and rules, backend + frontend
  architecture, UI component inventory.

## Decisions
- 2026-09-24 · framed · Search matches **display name or username**; display names are a new
  optional field, added as part of this feature (Alejandro). Sign-up doesn't ask for one; it's set in
  Edit profile.
- 2026-09-24 · framed · Results appear in a right-rail typeahead **and** on Explore, so search works
  on phones, where there is no right rail (Alejandro). Result rows have a Follow button (Alejandro).
- 2026-09-24 · framed · The route is `/search/users`, not `/users/search`: `search` isn't a
  reserved username, so `/users/search` would shadow a user called "search".
- 2026-09-24 · framed · Case-insensitive matching uses SQLite `LIKE`, which only folds ASCII case;
  good enough for now. Results are ordered by username (no relevance ranking).

## Follow-ups

## Log
- 2026-09-24 · framed
