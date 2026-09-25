import { apiClient } from '@/lib/api/client';

// Query key for a user's public profile (`GET /users/:username`). Usernames are stored lowercase
// and looked up case-insensitively, so the key is lowercased: `/u/Ada` and `/u/ada` share a cache
// entry. Exported so the edit-profile page can update/invalidate it.
export const profileQueryKey = (username) => ['users', username.toLowerCase(), 'profile'];

// Query-key factory for follow data. Every follow listing (followers / following of any user, the
// suggestions) lives under `['follows']` so the follow cache helpers (follow-cache.js) can reach
// every row of a user with one prefix — the same idea as `postKeys.lists()`. Usernames are
// lowercased, like `profileQueryKey`.
export const followKeys = {
  all: ['follows'],
  lists: () => ['follows', 'list'],
  followers: (username) => ['follows', 'list', 'followers', username.toLowerCase()],
  following: (username) => ['follows', 'list', 'following', username.toLowerCase()],
  suggestions: () => ['follows', 'suggestions'],
};

// Appends `?cursor=` only when there is one (the first page has none; an empty cursor is a 400).
const withCursor = (path, cursor) =>
  cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;

const userPath = (username) => `/users/${encodeURIComponent(username)}`;

// Resolves to `{ username, bio, createdAt, postCount, followerCount, followingCount, isFollowing,
// followsYou }`; rejects with an ApiError (404 for an unknown user).
export const fetchProfile = (username) => apiClient.get(userPath(username));

// `PATCH /users/me` with `{ username?, bio? }` (bio `''` clears it). Resolves to the caller's
// `{ id, email, username, bio, createdAt }`; rejects with an ApiError (409 taken username, 400).
export const updateMyProfile = (patch) => apiClient.patch('/users/me', patch);

// `FollowUser` = `{ username, bio, isFollowing, followsYou }` (the booleans are relative to the
// signed-in user). A follow page = `{ items: FollowUser[], nextCursor }`, most recent follow first.

// `PUT` / `DELETE /users/:username/follow` → `{ following, followerCount }`. Both are idempotent,
// so sending the intended final state (rather than "toggle") is safe to repeat. 404 unknown user,
// 400 following yourself.
export const setFollowing = (username, following) =>
  following
    ? apiClient.put(`${userPath(username)}/follow`)
    : apiClient.delete(`${userPath(username)}/follow`);

export const followUser = (username) => setFollowing(username, true);

export const unfollowUser = (username) => setFollowing(username, false);

// `GET /users/:username/followers` — 404 for an unknown user.
export const fetchFollowers = (username, cursor) =>
  apiClient.get(withCursor(`${userPath(username)}/followers`, cursor));

// `GET /users/:username/following` — 404 for an unknown user.
export const fetchFollowing = (username, cursor) =>
  apiClient.get(withCursor(`${userPath(username)}/following`, cursor));

// `GET /users/me/suggestions` → `{ items: FollowUser[] }`: users the caller doesn't follow, newest
// accounts first (the server defaults to 3).
export const fetchSuggestions = () => apiClient.get('/users/me/suggestions');
