import { apiClient } from '@/lib/api/client';
import type {
  FollowState,
  FollowUser,
  MyProfile,
  Page,
  Profile,
  ProfilePatch,
} from '@/lib/api/types';

// Query key for a user's public profile (`GET /users/:username`). Usernames are stored lowercase
// and looked up case-insensitively, so the key is lowercased: `/u/Ada` and `/u/ada` share a cache
// entry. Exported so the edit-profile page can update/invalidate it.
export const profileQueryKey = (username: string) =>
  ['users', username.toLowerCase(), 'profile'] as const;

// Query-key factory for follow data. Every follow listing (followers / following of any user, the
// suggestions) lives under `['follows']` so the follow cache helpers (follow-cache.js) can reach
// every row of a user with one prefix — the same idea as `postKeys.lists()`. Usernames are
// lowercased, like `profileQueryKey`.
export const followKeys = {
  all: ['follows'] as const,
  lists: () => ['follows', 'list'] as const,
  followers: (username: string) =>
    ['follows', 'list', 'followers', username.toLowerCase()] as const,
  following: (username: string) =>
    ['follows', 'list', 'following', username.toLowerCase()] as const,
  suggestions: () => ['follows', 'suggestions'] as const,
};

// Appends `?cursor=` only when there is one (the first page has none; an empty cursor is a 400).
const withCursor = (path: string, cursor?: string | null) =>
  cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;

const userPath = (username: string) => `/users/${encodeURIComponent(username)}`;

// Resolves to `{ username, displayName, bio, createdAt, postCount, followerCount, followingCount,
// isFollowing, followsYou }` (`displayName` null until the user sets one); rejects with an ApiError
// (404 for an unknown user).
export const fetchProfile = (username: string) => apiClient.get<Profile>(userPath(username));

// `PATCH /users/me` with `{ username?, bio?, displayName? }` (bio `''` clears it; a display name
// can be set or changed but not cleared — `''` is a 400). Resolves to the caller's `{ id, email,
// username, displayName, bio, createdAt, postCount, followerCount, followingCount }`; rejects with
// an ApiError (409 taken username, 400).
export const updateMyProfile = (patch: ProfilePatch) =>
  apiClient.patch<MyProfile>('/users/me', patch);

// `FollowUser` = `{ username, displayName, bio, isFollowing, followsYou }` (`displayName` may be
// null; the booleans are relative to the signed-in user). A follow page = `{ items: FollowUser[], nextCursor }`, most recent follow first.

// `PUT` / `DELETE /users/:username/follow` → `{ following, followerCount }`. Both are idempotent,
// so sending the intended final state (rather than "toggle") is safe to repeat. 404 unknown user,
// 400 following yourself.
export const setFollowing = (username: string, following: boolean) =>
  following
    ? apiClient.put<FollowState>(`${userPath(username)}/follow`)
    : apiClient.delete<FollowState>(`${userPath(username)}/follow`);

// `GET /users/:username/followers` — 404 for an unknown user.
export const fetchFollowers = (username: string, cursor?: string | null) =>
  apiClient.get<Page<FollowUser>>(withCursor(`${userPath(username)}/followers`, cursor));

// `GET /users/:username/following` — 404 for an unknown user.
export const fetchFollowing = (username: string, cursor?: string | null) =>
  apiClient.get<Page<FollowUser>>(withCursor(`${userPath(username)}/following`, cursor));

// `GET /users/me/suggestions` → `{ items: FollowUser[] }`: users the caller doesn't follow, newest
// accounts first (the server defaults to 3).
export const fetchSuggestions = () =>
  apiClient.get<Pick<Page<FollowUser>, 'items'>>('/users/me/suggestions');
