// Response shapes of the API (mirrors backend/src/modules/*/dto/*-response.dto.ts). Dates arrive
// as ISO-8601 strings. Nullable fields are `null` (never missing) in responses.

// One page of a cursor-paginated listing; `nextCursor` is null on the last page.
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// `GET /auth/me`, and what sign-in / sign-up resolve to.
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  // null for accounts created before display names existed.
  displayName: string | null;
}

// A post's (or comment's, or a notification's) author.
export interface PostAuthor {
  username: string;
  // null until the author sets one.
  displayName: string | null;
}

export interface Post {
  id: string;
  body: string;
  createdAt: string;
  author: PostAuthor;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: PostAuthor;
}

// `PUT` / `DELETE /posts/:id/like`.
export interface LikeState {
  liked: boolean;
  likeCount: number;
}

// `GET /users/:username` — another user's (or the caller's) public profile.
export interface Profile {
  username: string;
  displayName: string | null;
  bio: string | null;
  createdAt: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
  // The caller follows this user (false on the caller's own profile).
  isFollowing: boolean;
  // This user follows the caller (false on the caller's own profile).
  followsYou: boolean;
}

// `PATCH /users/me` — the caller's own profile.
export interface MyProfile {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  createdAt: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
}

export interface ProfilePatch {
  username?: string;
  displayName?: string;
  bio?: string;
}

// A user in a followers / following list, the suggestions or a search result.
export interface FollowUser {
  username: string;
  displayName: string | null;
  bio: string | null;
  isFollowing: boolean;
  followsYou: boolean;
}

// `PUT` / `DELETE /users/:username/follow`.
export interface FollowState {
  following: boolean;
  followerCount: number;
}

export type NotificationType = 'follow' | 'like' | 'comment';

// The post or comment a notification is about.
export interface NotificationSubject {
  id: string;
  body: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  createdAt: string;
  read: boolean;
  actor: PostAuthor;
  // null for a follow.
  post: NotificationSubject | null;
  // Set only for a comment notification.
  comment: NotificationSubject | null;
}

export interface UnreadCount {
  count: number;
}

// Messages on the `GET /events` stream, by SSE event name.
export interface RealtimeEventMap {
  'post.created': { id: string; following: boolean };
  'post.deleted': { id: string };
  'post.counts': { id: string; likeCount: number; commentCount: number };
  'notifications.changed': { unreadCount: number };
}

export type RealtimeEventName = keyof RealtimeEventMap;
