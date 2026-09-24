import { apiClient } from '@/lib/api/client';

// Query key for a user's public profile (`GET /users/:username`). Usernames are stored lowercase
// and looked up case-insensitively, so the key is lowercased: `/u/Ada` and `/u/ada` share a cache
// entry. Exported so the edit-profile page can update/invalidate it.
export const profileQueryKey = (username) => ['users', username.toLowerCase(), 'profile'];

// Resolves to `{ username, bio, createdAt }`; rejects with an ApiError (404 for an unknown user).
export const fetchProfile = (username) =>
  apiClient.get(`/users/${encodeURIComponent(username)}`);

// `PATCH /users/me` with `{ username?, bio? }` (bio `''` clears it). Resolves to the caller's
// `{ id, email, username, bio, createdAt }`; rejects with an ApiError (409 taken username, 400).
export const updateMyProfile = (patch) => apiClient.patch('/users/me', patch);
