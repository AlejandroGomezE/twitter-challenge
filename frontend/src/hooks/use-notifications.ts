import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getNextPageParam } from '@/hooks/use-posts';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markNotificationsRead,
  notificationKeys,
} from '@/lib/api/notifications';
import { REALTIME_STATUS } from '@/lib/realtime/realtime-context';
import {
  useRealtimeEvent,
  useRealtimeReconnect,
  useRealtimeStatus,
} from '@/lib/realtime/use-realtime';

// How often the unread count is polled while the realtime stream is not connected (a fallback:
// while it is open, `notifications.changed` pushes the count).
export const UNREAD_COUNT_REFETCH_INTERVAL = 30_000;

// The session user's notifications, newest first, paged by cursor.
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam,
  });
}

// The session user's unread notification count (`data` = `{ count }`), for the nav badge.
// Refetched on window focus, and polled every 30s only while the realtime stream isn't open.
export function useUnreadNotificationCount() {
  const streamOpen = useRealtimeStatus() === REALTIME_STATUS.open;
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: fetchUnreadNotificationCount,
    refetchOnWindowFocus: true,
    refetchInterval: streamOpen ? false : UNREAD_COUNT_REFETCH_INTERVAL,
  });
}

// Keeps the notification caches in step with the realtime stream (mount once, inside the
// RealtimeProvider): `notifications.changed` writes the pushed unread count and marks the list
// stale (an open /notifications page refetches it, so a new row shows up; that page marks read
// only once per visit and keeps its highlights across refetches). After a reconnect, the count is
// refetched, since events missed while offline are not replayed.
export function useNotificationsRealtimeSync() {
  const queryClient = useQueryClient();

  useRealtimeEvent('notifications.changed', (data) => {
    if (typeof data?.unreadCount === 'number') {
      queryClient.setQueryData(notificationKeys.unreadCount(), { count: data.unreadCount });
    }
    queryClient.invalidateQueries({ queryKey: notificationKeys.list(), exact: true });
  });

  useRealtimeReconnect(() =>
    queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(), exact: true }),
  );
}

// `mutate(until)` where `until` is the newest `createdAt` shown. On success only the unread count
// is invalidated: the loaded list is deliberately left alone, so the page keeps highlighting the
// rows that were unread during this visit (from their loaded `read` flags).
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (until: string) => markNotificationsRead(until),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(), exact: true }),
  });
}
