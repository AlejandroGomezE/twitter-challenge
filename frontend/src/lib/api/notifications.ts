import { apiClient } from '@/lib/api/client';
import type { Notification, Page, UnreadCount } from '@/lib/api/types';

// Shapes (see features/notifications): `NotificationView` = `{ id, type: 'follow' | 'like' |
// 'comment', createdAt (ISO), read, actor: { username, displayName }, post: { id, body } | null,
// comment: { id, body } | null }`; a page = `{ items, nextCursor }` (`nextCursor` is null on the
// last page). Everything is scoped to the session user.

// Query-key factory. Everything lives under `['notifications']`; `list` and `unreadCount` are
// siblings, so invalidating the count (exact) never touches the loaded list.
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
  unreadCount: () => ['notifications', 'unread-count'] as const,
};

// `GET /notifications?cursor=&limit=` — newest first. `cursor` is only sent when there is one (the
// first page has none); `limit` is optional (server default).
export function fetchNotifications(
  cursor?: string | null,
  { limit }: { limit?: number | null } = {},
) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit !== undefined && limit !== null) params.set('limit', String(limit));
  const query = params.toString();
  return apiClient.get<Page<Notification>>(query ? `/notifications?${query}` : '/notifications');
}

// `GET /notifications/unread-count` → `{ count }`.
export const fetchUnreadNotificationCount = () =>
  apiClient.get<UnreadCount>('/notifications/unread-count');

// `POST /notifications/read` `{ until }` → null (204). Marks the session user's unread
// notifications with `createdAt <= until` as read, so one that arrived after `until` stays unread.
export const markNotificationsRead = (until: string) =>
  apiClient.post<null>('/notifications/read', { until });
