import {
  Bell,
  Bookmark,
  Hash,
  Home,
  LogOut,
  Mail,
  Settings,
  User,
  type LucideIcon,
} from 'lucide-react'

// The live counts a nav item can show as a badge (see `useNavBadgeCounts`).
export type NavBadgeKey = 'notifications'

interface NavItemConfigBase {
  key: string
  label: string
  icon: LucideIcon
  mobile: boolean
  desktop?: boolean
  requiresUsername?: boolean
}

// A working item: `to` builds its path from the signed-in user's username.
interface NavLinkConfig extends NavItemConfigBase {
  to: (username: string) => string
  end?: boolean
  badge?: NavBadgeKey
}

// A "Coming soon" placeholder.
interface NavPlaceholderConfig extends NavItemConfigBase {
  to?: undefined
  end?: undefined
  badge?: undefined
}

type NavItemConfig = NavLinkConfig | NavPlaceholderConfig

interface NavItemBase {
  key: string
  label: string
  icon: LucideIcon
  end: boolean
}

export interface NavLinkItem extends NavItemBase {
  to: string
  disabled: false
  badge: NavBadgeKey | null
}

export interface NavPlaceholderItem extends NavItemBase {
  to: undefined
  disabled: true
  badge: null
}

// A nav item resolved for the signed-in user (see `getNavItems`).
export type NavItem = NavLinkItem | NavPlaceholderItem

// Sign-out always goes through the /sign-out page (the single sign-out path). The bottom bar shows
// it as its last icon; the left rail renders it in its footer (via `getSignOutItem`), not the nav.
const SIGN_OUT_ITEM: NavLinkConfig = {
  key: 'sign-out',
  label: 'Sign out',
  icon: LogOut,
  to: () => '/sign-out',
  mobile: true,
  desktop: false,
}

// One source of truth for the left rail (SideNav) and the bottom bar (MobileNav). An item with a
// `to` builder is a working route; an item without one is a disabled "Coming soon" placeholder
// (never a link, so never a badge). A working item may declare a `badge` key naming the live count
// it shows (resolved by `useNavBadgeCounts`; `'notifications'` = unread notifications). `mobile`
// marks the items the bottom bar shows (Settings is reached there through the profile's "Edit
// profile"); `desktop: false` keeps an item out of the left rail's nav.
const NAV_ITEMS: NavItemConfig[] = [
  { key: 'home', label: 'Home', icon: Home, to: () => '/', end: true, mobile: true },
  { key: 'explore', label: 'Explore', icon: Hash, to: () => '/explore', mobile: true },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: Bell,
    to: () => '/notifications',
    badge: 'notifications',
    mobile: true,
  },
  { key: 'messages', label: 'Messages', icon: Mail, mobile: true },
  { key: 'bookmarks', label: 'Bookmarks', icon: Bookmark, mobile: false },
  {
    key: 'profile',
    label: 'Profile',
    icon: User,
    to: (username) => `/u/${encodeURIComponent(username)}`,
    requiresUsername: true,
    mobile: true,
  },
  { key: 'settings', label: 'Settings', icon: Settings, to: () => '/settings/profile', mobile: false },
  SIGN_OUT_ITEM,
]

function resolve(item: NavLinkConfig, username?: string | null): NavLinkItem
function resolve(item: NavItemConfig, username?: string | null): NavItem
function resolve(
  { key, label, icon, to, end = false, badge }: NavItemConfig,
  username?: string | null,
): NavItem {
  // `username` is only missing for items that don't use it (Profile is left out without one).
  return to
    ? { key, label, icon, to: to(username ?? ''), end, disabled: false, badge: badge ?? null }
    : { key, label, icon, to: undefined, end, disabled: true, badge: null }
}

// Resolves the nav for the signed-in user: `{ key, label, icon, to, end, disabled, badge }`
// (`badge` is the item's count key, or null). Profile is left out while the user has no username
// (it would have nowhere to point).
export function getNavItems(
  username?: string | null,
  { mobile = false }: { mobile?: boolean } = {},
): NavItem[] {
  return NAV_ITEMS.filter((item) => (mobile ? item.mobile : item.desktop !== false))
    .filter((item) => !item.requiresUsername || Boolean(username))
    .map((item) => resolve(item, username))
}

// The resolved Sign out entry, for the left rail's footer.
export const getSignOutItem = () => resolve(SIGN_OUT_ITEM)

// The largest count a nav badge shows as-is; anything above reads "99+".
export const MAX_BADGE_COUNT = 99

// What a nav badge displays for `count`, or null when there is nothing to show (0 or unknown).
export function formatBadgeCount(count: unknown): string | null {
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count)
}

// The item's accessible name: its label, plus the exact unread count when it has one to show
// (e.g. "Notifications, 3 unread"), so the badge itself stays aria-hidden.
export function navItemLabel(label: string, count?: number | null): string {
  return formatBadgeCount(count) ? `${label}, ${count} unread` : label
}
