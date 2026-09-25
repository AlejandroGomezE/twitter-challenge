import { useUnreadNotificationCount } from '@/hooks/use-notifications'

// The live counts behind the nav items' `badge` keys (see nav-items.js), shared by the left rail
// and the bottom bar. A count is `undefined` while unknown (loading or failed).
export function useNavBadgeCounts() {
  const { data } = useUnreadNotificationCount()
  return { notifications: data?.count }
}
