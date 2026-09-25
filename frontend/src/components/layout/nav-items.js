import { Bell, Bookmark, Hash, Home, LogOut, Mail, Settings, User } from 'lucide-react'

// Sign-out always goes through the /sign-out page (the single sign-out path). The bottom bar shows
// it as its last icon; the left rail renders it in its footer (via `getSignOutItem`), not the nav.
const SIGN_OUT_ITEM = {
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
const NAV_ITEMS = [
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

const resolve = ({ key, label, icon, to, end = false, badge = null }, username) => ({
  key,
  label,
  icon,
  to: to ? to(username) : undefined,
  end,
  disabled: !to,
  badge: to ? badge : null,
})

// Resolves the nav for the signed-in user: `{ key, label, icon, to, end, disabled, badge }`
// (`badge` is the item's count key, or null). Profile is left out while the user has no username
// (it would have nowhere to point).
export function getNavItems(username, { mobile = false } = {}) {
  return NAV_ITEMS.filter((item) => (mobile ? item.mobile : item.desktop !== false))
    .filter((item) => !item.requiresUsername || Boolean(username))
    .map((item) => resolve(item, username))
}

// The resolved Sign out entry, for the left rail's footer.
export const getSignOutItem = () => resolve(SIGN_OUT_ITEM)

// The largest count a nav badge shows as-is; anything above reads "99+".
export const MAX_BADGE_COUNT = 99

// What a nav badge displays for `count`, or null when there is nothing to show (0 or unknown).
export function formatBadgeCount(count) {
  if (!Number.isInteger(count) || count <= 0) return null
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count)
}

// The item's accessible name: its label, plus the exact unread count when it has one to show
// (e.g. "Notifications, 3 unread"), so the badge itself stays aria-hidden.
export function navItemLabel(label, count) {
  return formatBadgeCount(count) ? `${label}, ${count} unread` : label
}
