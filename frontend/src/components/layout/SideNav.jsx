import { Feather } from 'lucide-react'
import { Link, NavLink } from 'react-router'
import { BrandMark } from '@/components/BrandMark'
import { UserAvatar } from '@/components/UserAvatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useOpenComposer } from '@/hooks/use-open-composer'
import { useAuth } from '@/lib/auth/use-auth'
import { cn } from '@/lib/utils'
import { ComingSoon } from './ComingSoon'
import { formatBadgeCount, getNavItems, getSignOutItem, navItemLabel } from './nav-items'
import { useNavBadgeCounts } from './use-nav-badge-counts'

const itemClassName =
  'flex items-center gap-4 rounded-full px-3 py-2.5 text-lg transition outline-none focus-visible:ring-3 focus-visible:ring-ring/50 xl:pr-6'

// Left rail (lg and up): logo, primary nav, "New post" (→ Home, focusing the composer), then the
// signed-in user chip and Sign out at the bottom. Labels collapse to icons below xl, so every item carries an
// `aria-label` (which includes the unread count when the item shows a badge). A badge always sits on
// the item's icon, with or without the label.
export function SideNav() {
  const { user } = useAuth()
  const username = user?.username
  const items = getNavItems(username)
  const signOut = getSignOutItem()
  const SignOutIcon = signOut.icon
  const openComposer = useOpenComposer()
  const badgeCounts = useNavBadgeCounts()

  return (
    <div className="flex h-dvh flex-col gap-1 px-3 py-5 xl:px-5">
      <Link
        to="/"
        aria-label="The Flock Twitter home"
        className="mb-4 flex items-center gap-2.5 rounded-xl px-3 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <BrandMark />
        <span className="hidden text-xl font-semibold tracking-tight xl:inline">The Flock Twitter</span>
      </Link>

      <nav aria-label="Primary" className="flex flex-col gap-1">
        {items.map(({ key, label, icon: Icon, to, end, disabled, badge }) => {
          const count = badge ? badgeCounts[badge] : undefined
          const badgeText = formatBadgeCount(count)
          return disabled ? (
            <ComingSoon key={key}>
              <button type="button" aria-label={label} className={cn(itemClassName, 'text-foreground/80')}>
                <Icon className="size-6" aria-hidden="true" />
                <span className="hidden xl:inline">{label}</span>
              </button>
            </ComingSoon>
          ) : (
            <NavLink
              key={key}
              to={to}
              end={end}
              aria-label={navItemLabel(label, count)}
              className={({ isActive }) =>
                cn(
                  itemClassName,
                  'hover:bg-secondary',
                  isActive ? 'font-semibold text-foreground' : 'text-foreground/80',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative flex">
                    <Icon className={cn('size-6', isActive && 'text-primary')} aria-hidden="true" />
                    {badgeText && (
                      <Badge
                        aria-hidden="true"
                        className="absolute -top-1.5 -right-2 h-4 min-w-4 px-1 text-[10px] tabular-nums ring-2 ring-background"
                      >
                        {badgeText}
                      </Badge>
                    )}
                  </span>
                  <span className="hidden xl:inline">{label}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      <Button
        type="button"
        aria-label="New post"
        onClick={openComposer}
        className="mt-4 h-12 rounded-full text-base font-semibold shadow-sm xl:w-full"
      >
        <Feather className="size-5 xl:hidden" aria-hidden="true" />
        <span className="hidden xl:inline">New post</span>
      </Button>

      <div className="mt-auto flex flex-col gap-1">
        {username && (
          <div className="flex items-center gap-3 rounded-full p-2">
            <UserAvatar username={username} size="lg" />
            <p className="hidden min-w-0 truncate font-mono text-sm text-muted-foreground xl:block">
              @{username}
            </p>
          </div>
        )}
        <Link
          to={signOut.to}
          aria-label={signOut.label}
          className={cn(itemClassName, 'text-base text-foreground/80 hover:bg-secondary')}
        >
          <SignOutIcon className="size-6" aria-hidden="true" />
          <span className="hidden xl:inline">{signOut.label}</span>
        </Link>
      </div>
    </div>
  )
}
