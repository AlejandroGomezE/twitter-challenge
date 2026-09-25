import { apiClient } from '@/lib/api/client';
import type { Comment, LikeState, Page, Post } from '@/lib/api/types';

// Shapes (see features/twitter-posts): `Post` = `{ id, body, createdAt, author: { username },
// likeCount, commentCount, likedByMe }`; `Comment` = `{ id, body, createdAt, author: { username } }`;
// a page = `{ items, nextCursor }` (`nextCursor` is null on the last page).

// Query-key factory. Every post list (both feeds, a user's posts) lives under `['posts', 'list', …]`
// so cache helpers (post-cache.js) can reach all of them with one prefix. `feed` (Following) and
// `forYou` are siblings, not nested, so invalidating one never touches the other. Usernames are lowercased:
// `/u/Ada` and `/u/ada` share a cache entry (same as `profileQueryKey`).
export const postKeys = {
  all: ['posts'] as const,
  lists: () => ['posts', 'list'] as const,
  feed: () => ['posts', 'list', 'feed'] as const,
  forYou: () => ['posts', 'list', 'for-you'] as const,
  userPosts: (username: string) => ['posts', 'list', 'user', username.toLowerCase()] as const,
  details: () => ['posts', 'detail'] as const,
  detail: (id: string) => ['posts', 'detail', id] as const,
  comments: (id: string) => ['posts', 'comments', id] as const,
};

// Appends `?cursor=` only when there is one (the first page has none).
const withCursor = (path: string, cursor?: string | null) =>
  cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;

const postPath = (id: string) => `/posts/${encodeURIComponent(id)}`;

// `GET /feed` — the Following feed (the caller + everyone they follow), newest first.
export const fetchFeed = (cursor?: string | null) => apiClient.get<Page<Post>>(withCursor('/feed', cursor));

// `GET /feed/for-you` — the For you feed (every user's posts), newest first.
export const fetchForYouFeed = (cursor?: string | null) =>
  apiClient.get<Page<Post>>(withCursor('/feed/for-you', cursor));

// `GET /users/:username/posts` — newest first; 404 for an unknown user.
export const fetchUserPosts = (username: string, cursor?: string | null) =>
  apiClient.get<Page<Post>>(withCursor(`/users/${encodeURIComponent(username)}/posts`, cursor));

// `GET /posts/:id` — 404 for an unknown id.
export const fetchPost = (id: string) => apiClient.get<Post>(postPath(id));

// `POST /posts` `{ body }` → the created Post (400 invalid body, 429 rate limited).
export const createPost = (body: string) => apiClient.post<Post>('/posts', { body });

// `DELETE /posts/:id` → null (204); 403 if not yours, 404 if missing.
export const deletePost = (id: string) => apiClient.delete<null>(postPath(id));

// `PUT` / `DELETE /posts/:id/like` → `{ liked, likeCount }`. Both are idempotent, so sending the
// intended final state (rather than "toggle") is safe to repeat.
export const setPostLiked = (id: string, liked: boolean) =>
  liked
    ? apiClient.put<LikeState>(`${postPath(id)}/like`)
    : apiClient.delete<LikeState>(`${postPath(id)}/like`);

// `GET /posts/:id/comments` — oldest first.
export const fetchComments = (postId: string, cursor?: string | null) =>
  apiClient.get<Page<Comment>>(withCursor(`${postPath(postId)}/comments`, cursor));

// `POST /posts/:id/comments` `{ body }` → the created Comment.
export const createComment = (postId: string, body: string) =>
  apiClient.post<Comment>(`${postPath(postId)}/comments`, { body });

// `DELETE /posts/:id/comments/:commentId` → null (204); 403 if not yours, 404 if missing.
export const deleteComment = (postId: string, commentId: string) =>
  apiClient.delete<null>(`${postPath(postId)}/comments/${encodeURIComponent(commentId)}`);
