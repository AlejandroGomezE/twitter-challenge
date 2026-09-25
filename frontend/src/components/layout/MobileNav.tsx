import { NavLink } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/auth/use-auth'
import { cn } from '@/lib/utils'
import { formatBadgeCount, getNavItems, navItemLabel } from './nav-items'
import { useNavBadgeCounts } from './use-nav-badge-counts'

const itemClassName =
  'flex flex-1 justify-center py-3.5 outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50'

// Bottom bar below lg: the same nav config as the left rail, icons only (a count badge sits on the
// icon, and the count is part of the item's `aria-label`).
export function MobileNav() {
  const { user } = useAuth()
  const items = getNavItems(user?.username, { mobile: true })
  const badgeCounts = useNavBadgeCounts()

  return (
    <nav
      aria-label="Primary (mobile)"
      className="sticky bottom-0 z-20 flex items-center justify-around border-t border-border bg-background/85 backdrop-blur-md lg:hidden"
    >
      {items.map(({ key, label, icon: Icon, to, end, badge }) => {
        const count = badge ? badgeCounts[badge] : undefined
        const badgeText = formatBadgeCount(count)
        return (
          <NavLink
            key={key}
            to={to}
            end={end}
            aria-label={navItemLabel(label, count)}
            className={itemClassName}
          >
            {({ isActive }) => (
              <span className="relative flex">
                <Icon
                  className={cn('size-6', isActive ? 'text-primary' : 'text-muted-foreground')}
                  aria-hidden="true"
                />
                {badgeText && (
                  <Badge
                    aria-hidden="true"
                    className="absolute -top-1.5 -right-2 h-4 min-w-4 px-1 text-[10px] tabular-nums ring-2 ring-background"
                  >
                    {badgeText}
                  </Badge>
                )}
              </span>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
