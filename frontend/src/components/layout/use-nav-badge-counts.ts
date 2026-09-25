import { useUnreadNotificationCount } from '@/hooks/use-notifications'
import type { NavBadgeKey } from './nav-items'

// The live counts behind the nav items' `badge` keys (see nav-items.ts), shared by the left rail
// and the bottom bar. A count is `undefined` while unknown (loading or failed).
export function useNavBadgeCounts(): Record<NavBadgeKey, number | undefined> {
  const { data } = useUnreadNotificationCount()
  return { notifications: data?.count }
}
