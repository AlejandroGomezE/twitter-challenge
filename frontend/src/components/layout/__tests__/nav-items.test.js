import { describe, expect, it } from 'vitest'
import { getNavItems, getSignOutItem } from '../nav-items'

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

    for (const key of ['notifications', 'messages', 'bookmarks']) {
      expect(byKey(items, key)).toMatchObject({ disabled: true, to: undefined })
    }
    expect(keysOf(items.filter((item) => item.disabled))).toEqual([
      'notifications',
      'messages',
      'bookmarks',
    ])
    expect(keysOf(getNavItems('ada', { mobile: true }).filter((item) => item.disabled))).toEqual([
      'notifications',
      'messages',
    ])
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
