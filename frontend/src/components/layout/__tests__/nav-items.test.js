import { describe, expect, it } from 'vitest'
import { formatBadgeCount, getNavItems, getSignOutItem, navItemLabel } from '../nav-items'

const keysOf = (items) => items.map((item) => item.key)
const byKey = (items, key) => items.find((item) => item.key === key)

describe('getNavItems', () => {
  it('lists the desktop nav without Sign out (the left rail renders it in its footer)', () => {
    expect(keysOf(getNavItems('ada'))).toEqual([
      'home',
      'explore',
      'notifications',
      'messages',
      'bookmarks',
      'profile',
      'settings',
    ])
  })

  it('lists the mobile nav: Home, Explore, Notifications, Messages, Profile, Sign out', () => {
    const items = getNavItems('ada', { mobile: true })

    expect(items.map((item) => item.label)).toEqual([
      'Home',
      'Explore',
      'Notifications',
      'Messages',
      'Profile',
      'Sign out',
    ])
  })

  it('resolves the working items to their paths', () => {
    const items = getNavItems('ada')

    expect(byKey(items, 'home')).toMatchObject({ label: 'Home', to: '/', end: true, disabled: false })
    expect(byKey(items, 'explore')).toMatchObject({
      label: 'Explore',
      to: '/explore',
      end: false,
      disabled: false,
    })
    expect(byKey(getNavItems('ada', { mobile: true }), 'explore')).toMatchObject({
      to: '/explore',
      disabled: false,
    })
    for (const navItems of [items, getNavItems('ada', { mobile: true })]) {
      expect(byKey(navItems, 'notifications')).toMatchObject({
        label: 'Notifications',
        to: '/notifications',
        end: false,
        disabled: false,
      })
    }
    expect(byKey(items, 'profile')).toMatchObject({
      label: 'Profile',
      to: '/u/ada',
      end: false,
      disabled: false,
    })
    expect(byKey(items, 'settings')).toMatchObject({
      label: 'Settings',
      to: '/settings/profile',
      disabled: false,
    })
    expect(byKey(getNavItems('ada', { mobile: true }), 'sign-out')).toMatchObject({
      label: 'Sign out',
      to: '/sign-out',
      disabled: false,
    })
  })

  it('encodes the username in the Profile path', () => {
    expect(byKey(getNavItems('a b/c'), 'profile').to).toBe('/u/a%20b%2Fc')
  })

  it.each([undefined, null, ''])('omits Profile when the username is %p', (username) => {
    expect(keysOf(getNavItems(username))).not.toContain('profile')
    expect(keysOf(getNavItems(username, { mobile: true }))).not.toContain('profile')
    expect(keysOf(getNavItems(username))).toContain('home')
  })

  it('flags the "Coming soon" items as disabled, with no path', () => {
    const items = getNavItems('ada')

    for (const key of ['messages', 'bookmarks']) {
      expect(byKey(items, key)).toMatchObject({ disabled: true, to: undefined, badge: null })
    }
    expect(keysOf(items.filter((item) => item.disabled))).toEqual(['messages', 'bookmarks'])
    expect(keysOf(getNavItems('ada', { mobile: true }).filter((item) => item.disabled))).toEqual([
      'messages',
    ])
  })

  it('gives only Notifications a badge (the unread-notifications count), in both navs', () => {
    for (const items of [getNavItems('ada'), getNavItems('ada', { mobile: true })]) {
      expect(byKey(items, 'notifications').badge).toBe('notifications')
      expect(keysOf(items.filter((item) => item.badge))).toEqual(['notifications'])
    }
  })

  it('gives every item a label and an icon component', () => {
    for (const item of [...getNavItems('ada'), ...getNavItems('ada', { mobile: true })]) {
      expect(item.label).toEqual(expect.any(String))
      expect(item.icon).toBeTruthy()
    }
  })
})

describe('getSignOutItem', () => {
  it('resolves Sign out to the /sign-out page', () => {
    expect(getSignOutItem()).toMatchObject({
      key: 'sign-out',
      label: 'Sign out',
      to: '/sign-out',
      end: false,
      disabled: false,
    })
    expect(getSignOutItem().icon).toBeTruthy()
  })
})

describe('formatBadgeCount', () => {
  it.each([undefined, null, 0, -1, 1.5, '3'])('shows nothing for %p', (count) => {
    expect(formatBadgeCount(count)).toBeNull()
  })

  it.each([
    [1, '1'],
    [42, '42'],
    [99, '99'],
    [100, '99+'],
    [1234, '99+'],
  ])('shows %p as %p', (count, text) => {
    expect(formatBadgeCount(count)).toBe(text)
  })
})

describe('navItemLabel', () => {
  it('adds the exact unread count to the label when there is one', () => {
    expect(navItemLabel('Notifications', 3)).toBe('Notifications, 3 unread')
    expect(navItemLabel('Notifications', 150)).toBe('Notifications, 150 unread')
  })

  it.each([undefined, null, 0])('is just the label when the count is %p', (count) => {
    expect(navItemLabel('Notifications', count)).toBe('Notifications')
  })
})
