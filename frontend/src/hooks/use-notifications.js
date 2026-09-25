import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getNextPageParam } from '@/hooks/use-posts';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markNotificationsRead,
  notificationKeys,
} from '@/lib/api/notifications';

// How often the unread count is polled while the app is open (there is no live push yet).
export const UNREAD_COUNT_REFETCH_INTERVAL = 30_000;

// The session user's notifications, newest first, paged by cursor.
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: null,
    getNextPageParam,
  });
}

// The session user's unread notification count (`data` = `{ count }`), for the nav badge. Polled
// every 30s and refetched on window focus.
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: fetchUnreadNotificationCount,
    refetchOnWindowFocus: true,
    refetchInterval: UNREAD_COUNT_REFETCH_INTERVAL,
  });
}

// `mutate(until)` where `until` is the newest `createdAt` shown. On success only the unread count
// is invalidated: the loaded list is deliberately left alone, so the page keeps highlighting the
// rows that were unread during this visit (from their loaded `read` flags).
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (until) => markNotificationsRead(until),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(), exact: true }),
  });
}
