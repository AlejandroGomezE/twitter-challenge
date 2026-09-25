import { apiClient } from '@/lib/api/client';

// Shapes (see features/twitter-posts): `Post` = `{ id, body, createdAt, author: { username },
// likeCount, commentCount, likedByMe }`; `Comment` = `{ id, body, createdAt, author: { username } }`;
// a page = `{ items, nextCursor }` (`nextCursor` is null on the last page).

// Query-key factory. Every post list (both feeds, a user's posts) lives under `['posts', 'list', …]`
// so cache helpers (post-cache.js) can reach all of them with one prefix. `feed` (Following) and
// `forYou` are siblings, not nested, so invalidating one never touches the other. Usernames are lowercased:
// `/u/Ada` and `/u/ada` share a cache entry (same as `profileQueryKey`).
export const postKeys = {
  all: ['posts'],
  lists: () => ['posts', 'list'],
  feed: () => ['posts', 'list', 'feed'],
  forYou: () => ['posts', 'list', 'for-you'],
  userPosts: (username) => ['posts', 'list', 'user', username.toLowerCase()],
  details: () => ['posts', 'detail'],
  detail: (id) => ['posts', 'detail', id],
  comments: (id) => ['posts', 'comments', id],
};

// Appends `?cursor=` only when there is one (the first page has none).
const withCursor = (path, cursor) =>
  cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;

const postPath = (id) => `/posts/${encodeURIComponent(id)}`;

// `GET /feed` — the Following feed (the caller + everyone they follow), newest first.
export const fetchFeed = (cursor) => apiClient.get(withCursor('/feed', cursor));

// `GET /feed/for-you` — the For you feed (every user's posts), newest first.
export const fetchForYouFeed = (cursor) => apiClient.get(withCursor('/feed/for-you', cursor));

// `GET /users/:username/posts` — newest first; 404 for an unknown user.
export const fetchUserPosts = (username, cursor) =>
  apiClient.get(withCursor(`/users/${encodeURIComponent(username)}/posts`, cursor));

// `GET /posts/:id` — 404 for an unknown id.
export const fetchPost = (id) => apiClient.get(postPath(id));

// `POST /posts` `{ body }` → the created Post (400 invalid body, 429 rate limited).
export const createPost = (body) => apiClient.post('/posts', { body });

// `DELETE /posts/:id` → null (204); 403 if not yours, 404 if missing.
export const deletePost = (id) => apiClient.delete(postPath(id));

// `PUT` / `DELETE /posts/:id/like` → `{ liked, likeCount }`. Both are idempotent, so sending the
// intended final state (rather than "toggle") is safe to repeat.
export const setPostLiked = (id, liked) =>
  liked ? apiClient.put(`${postPath(id)}/like`) : apiClient.delete(`${postPath(id)}/like`);

// `GET /posts/:id/comments` — oldest first.
export const fetchComments = (postId, cursor) =>
  apiClient.get(withCursor(`${postPath(postId)}/comments`, cursor));

// `POST /posts/:id/comments` `{ body }` → the created Comment.
export const createComment = (postId, body) =>
  apiClient.post(`${postPath(postId)}/comments`, { body });

// `DELETE /posts/:id/comments/:commentId` → null (204); 403 if not yours, 404 if missing.
export const deleteComment = (postId, commentId) =>
  apiClient.delete(`${postPath(postId)}/comments/${encodeURIComponent(commentId)}`);
