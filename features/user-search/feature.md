---
slug: user-search
status: verifying
scope: full-stack
next: /close-feature user-search
---
# User search (with display names)

Users get a **display name** (required at sign-up; existing users start without one), shown
wherever a user appears. Search finds users by display
name or username: a typeahead dropdown under the right-rail search box, plus a full results page on
**Explore** (so phones can search too). The rail search box's focus outline is no longer clipped.

## Plan
- Touched surface:
  - `backend/prisma/schema.prisma` (`User.displayName`), `auth` (sign-up DTO/service, user
    response DTO), `modules/users` (PATCH /users/me, profile
    DTOs, new search endpoint), `modules/posts` (post/comment author DTO), `modules/follows`
    (`FollowUser` DTO).
  - `frontend/src/lib/validation/profile-schemas.js` (+ the sign-up schema), `pages/SignUp.jsx`,
    `pages/EditProfile.jsx`, `pages/Profile.jsx`,
    `components/feed/PostCard.jsx` + `CommentItem.jsx`, `components/FollowListDialog.jsx`,
    `components/layout/RightRail.jsx` (profile card, Who to follow, search box), new Explore page,
    `nav-items.js`, `app/router.jsx`, new search API/hooks.
  - Docs: Runbook, backend/frontend architecture, UI component inventory.
- API contract (all behind the global AuthGuard):
  - `User.displayName`: nullable string, trimmed, 1–50 characters (code points), no line breaks.
    Existing users are left `null` (no backfill).
  - `POST /auth/sign-up` **requires** `displayName` (same rules; missing/blank → 400).
  - `PATCH /users/me` accepts `displayName` to set or change it (same rules); it can't be cleared
    (`''` → 400), so once set it stays set.
  - `displayName` (`string | null`) is added to: `GET /users/:username`, `PATCH /users/me`, the
    auth user responses (`sign-up`, `sign-in`, `GET /auth/me`), the post
    and comment `author` object (`{ username, displayName }`), and every `FollowUser` item (followers,
    following, suggestions).
  - `GET /search/users?q=&cursor=&limit=` → `{ items: FollowUser[], nextCursor: string | null }`.
    - `q`: trimmed, a leading `@` stripped, 1–50 characters after that; otherwise 400.
    - Matches users whose username **or** display name contains `q`, case-insensitive. The caller is
      included if they match; their row has no follow booleans set (both false).
    - Ordered by username ascending, keyset-paged on username; `limit` 1–50, default 20.
    - `FollowUser` = `{ username, displayName, bio, isFollowing, followsYou }`.
- Acceptance criteria:
  1. Sign-up has a required **Name** field (1–50, counted like the backend); the account is created
     with it. Existing users have no name until they set one in Edit profile, where anyone can set or
     change it (not clear it); it persists.
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
- [x] (T1, be) Prisma `User.displayName String?` + `db push`/`generate` (existing rows stay `null`).
  Display-name rules as shared constants (like the username/bio rules); `POST /auth/sign-up` requires
  it and stores it; auth user responses expose it; `PATCH /users/me` sets/changes it (no clearing);
  `ProfileResponseDto` + `MyProfileResponseDto` expose it. Unit + e2e specs.
- [x] (T2, be, after: T1) Expose `displayName` in the post/comment author DTO (`posts` module) and in
  `FollowUserResponseDto` (`follows` module), without extra queries per row. Update specs.
- [x] (T3, be, after: T1, T2) `GET /search/users` per the contract, in its own controller
  (`@Controller('search')`), reusing the follows relation batch lookup and `pagination.ts`; query DTO
  with `@Type` for `limit`. Unit + e2e specs (matching on each field, case-insensitivity, `@` strip,
  paging, 400s, no id/email).
- [x] (T4, fe) Display names in the UI: `displayName` rule in `profile-schemas.js`, a required Name
  field on the sign-up page (+ its schema), Edit profile field (set/change, not clear), and a small shared name component (display name + @username, falling back to @username)
  used on the profile header, PostCard, CommentItem, FollowListDialog rows, and the RightRail
  profile card + Who to follow rows. Tests.
- [x] (T5, fe) Search data layer: `lib/api` function + query keys and `hooks/use-user-search.js`
  (debounced typeahead query, limit 5; infinite query for Explore); disabled for an empty query; MSW
  default handler for `/search/users`. Tests.
- [x] (T6, fe, after: T4, T5) RightRail search box becomes a working combobox typeahead (the
  "Coming soon" wrapper goes), with a dropdown of up to 5 users, keyboard navigation, "See all
  results" → `/explore?q=`, closing on Escape and click-away. Fix the clipped focus outline (the rail
  is an `overflow-y-auto` container that cuts off the input's 3px ring; e.g. give the rail inline
  padding or inset the ring). Tests.
- [x] (T7, fe, after: T4, T5) Explore page at `/explore` (`?q=` in the URL, replaced while typing):
  search input, infinite results list with `FollowButton` rows, states for no query, no results,
  loading and errors; route in `router.jsx`; Explore enabled in `nav-items.js` (desktop + mobile).
  Tests.
- [x] (T9, fe) No layout shift when the page gains or loses a vertical scrollbar (e.g. Home → a short
  page): reserve the scrollbar gutter globally (`scrollbar-gutter: stable` on the root scroller in
  `index.css`), check sticky/fixed parts (side nav, right rail, mobile bottom bar, dialogs' scroll
  lock) don't jump either. Tests where practical.
- [x] (T8, fe, after: T1, T2, T3, T4, T6, T7, T9) Docs: Runbook endpoints and rules, backend + frontend
  architecture, UI component inventory.

## Decisions
- 2026-09-24 · framed · Search matches **display name or username**; display names are a new
  field, added as part of this feature (Alejandro). **Required at sign-up**; existing users stay
  empty (`null`, no backfill) until they set one in Edit profile (Alejandro). Once set it can be
  changed but not cleared, like Twitter.
- 2026-09-24 · framed · Results appear in a right-rail typeahead **and** on Explore, so search works
  on phones, where there is no right rail (Alejandro). Result rows have a Follow button (Alejandro).
- 2026-09-24 · framed · The route is `/search/users`, not `/users/search`: `search` isn't a
  reserved username, so `/users/search` would shadow a user called "search".
- 2026-09-24 · framed · Case-insensitive matching uses SQLite `LIKE`, which only folds ASCII case;
  good enough for now. Results are ordered by username (no relevance ranking).

- 2026-09-24 · building · New shared component `components/UserName.jsx` (display name bold + muted
  @username, falls back to @username) — **signed off by Alejandro**.
- 2026-09-24 · building · When a display name is set, profile links' accessible names are "Display
  Name @username" (e.g. Who to follow rows); plain "@username" otherwise — **kept** (Alejandro).

- 2026-09-24 · building · The right rail is 16px wider (`w-[366px] px-2`) so the search box's focus
  ring isn't clipped; the center column gives up to 16px at max width — fine (Alejandro).
- 2026-09-24 · building · Added T9: no content shift when a vertical scrollbar appears/disappears
  between pages (Alejandro).

- 2026-09-24 · building · The page reserves its scrollbar gutter (`scrollbar-gutter: stable` +
  a `body[data-scroll-locked]` override so dialogs don't double-compensate); the right rail's own
  scrollbar is left without a gutter — it only shifts content inside the rail (Alejandro).

## Follow-ups
- [ ] `ExploreRow` (`pages/Explore.jsx`) and `FollowListRow` (`components/FollowListDialog.jsx`) are
  near-identical user rows (avatar, UserName, bio, FollowButton) · could become one shared row.

- [ ] Verify seeded dev-DB users `sa_qsyh`, `sb_qsyh`, `sc_qsyh` (+ a post, a comment, follows) · clean up if
  unwanted.
- [ ] A backend (`node dist/main`) and a Vite dev server started at 20:52 during Build were left running
  (likely by a build agent, against CONVENTIONS §10) · stop them; consider telling implementers to
  never leave servers running.

## Log
- 2026-09-24 · framed
- 2026-09-24 · built — display names (required at sign-up, set/change in Edit profile, shown via UserName everywhere), GET /search/users (username or display name, literal %/_), right-rail typeahead, Explore page + nav, unclipped search focus ring (wider rail), stable scrollbar gutter; docs. BE 35 suites / 437 unit + 5 / 182 e2e, FE 43 suites / 492, build/lint green.
- 2026-09-24 · verified — all 5 ACs + T9 driven in headless Chrome + API and a real Chrome window (sign-up Name, edit/can't clear, names everywhere + fallback, typeahead keys/Enter/Escape, Explore via nav + mobile, unclipped focus ring, 0px scrollbar/dialog shift vs 7px without the fix)
