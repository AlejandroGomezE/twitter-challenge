import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import { notificationKeys } from '@/lib/api/notifications'
import { FakeEventSource, installFakeEventSource } from '@/test/fake-event-source'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

// The shell is a layout route, so render the real router signed in (default MSW handlers: ada,
// bio null). jsdom ignores the responsive `hidden`/`lg:` classes, so both navs are in the DOM:
// scope to the banner (left rail), the sidebar (right rail) or the mobile nav.
async function renderShell(route = '/') {
  const utils = renderWithProviders(<AppRouter />, { route })
  await screen.findByRole('banner')
  return utils
}

const leftRail = () => within(screen.getByRole('banner'))
const primaryNav = () => within(leftRail().getByRole('navigation', { name: 'Primary' }))
const rightRail = () => within(screen.getByRole('complementary', { name: 'Sidebar' }))
const mobileNav = () => within(screen.getByRole('navigation', { name: 'Primary (mobile)' }))

// Exposes the current location (path + history key), to tell whether a click navigated.
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location" data-key={location.key}>{location.pathname}</output>
}

async function renderShellWithProbe(route: string) {
  const utils = renderWithProviders(
    <>
      <AppRouter />
      <LocationProbe />
    </>,
    { route },
  )
  await screen.findByRole('banner')
  return utils
}

const composerTextbox = () =>
  within(screen.getByRole('main')).getByRole('textbox', { name: 'Compose a new post' })

const withUnreadCount = (count: number) =>
  server.use(http.get(apiUrl('/notifications/unread-count'), () => HttpResponse.json({ count })))

describe('AppShell', () => {
  describe('left rail', () => {
    it('shows the brand linking home', async () => {
      await renderShell()

      const brand = leftRail().getByRole('link', { name: 'The Flock Twitter home' })
      expect(brand).toHaveAttribute('href', '/')
      expect(brand).toHaveTextContent('The Flock Twitter')
    })

    it('marks Home active and links Profile and Settings', async () => {
      await renderShell()
      const nav = primaryNav()

      expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
      expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')

      const profile = nav.getByRole('link', { name: 'Profile' })
      expect(profile).toHaveAttribute('href', '/u/ada')
      expect(profile).not.toHaveAttribute('aria-current')

      const settings = nav.getByRole('link', { name: 'Settings' })
      expect(settings).toHaveAttribute('href', '/settings/profile')
      expect(settings).not.toHaveAttribute('aria-current')

      expect(nav.queryByRole('link', { name: 'Sign out' })).not.toBeInTheDocument()
    })

    it('has no Messages or Bookmarks item', async () => {
      await renderShell()
      const rail = leftRail()

      for (const name of ['Messages', 'Bookmarks']) {
        expect(rail.queryByRole('button', { name })).not.toBeInTheDocument()
        expect(rail.queryByRole('link', { name })).not.toBeInTheDocument()
      }
    })

    it('links Explore', async () => {
      await renderShell()

      expect(primaryNav().getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore')
    })

    it('links Notifications, with no badge when nothing is unread (default handlers)', async () => {
      await renderShell()

      const link = primaryNav().getByRole('link', { name: 'Notifications' })
      expect(link).toHaveAttribute('href', '/notifications')
      expect(link).not.toHaveAttribute('aria-current')
      expect(leftRail().queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
      expect(link.querySelector('[data-slot="badge"]')).toBeNull()
    })

    it('shows New post as an enabled button', async () => {
      await renderShell()

      const button = leftRail().getByRole('button', { name: 'New post' })
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute('aria-disabled')
    })

    it('shows the signed-in user chip and a Sign out link', async () => {
      await renderShell()
      const rail = leftRail()

      expect(rail.getByRole('img', { name: '@ada' })).toBeInTheDocument()
      expect(rail.getByText('@ada')).toBeInTheDocument()
      expect(rail.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/sign-out')
    })
  })

  describe('right rail', () => {
    it('shows "Your profile" with @ada, "No bio yet." and a View profile link', async () => {
      await renderShell()
      const card = within(rightRail().getByRole('region', { name: 'Your profile' }))

      expect(await card.findByText('No bio yet.')).toBeInTheDocument()
      expect(card.getByText('@ada')).toBeInTheDocument()
      expect(card.getByRole('img', { name: '@ada' })).toBeInTheDocument()
      expect(card.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/u/ada')
    })

    it('shows the bio when the profile has one', async () => {
      server.use(
        http.get(apiUrl('/users/:username'), () =>
          HttpResponse.json({
            username: 'ada',
            bio: 'Counting engines.',
            createdAt: '2026-09-15T12:00:00.000Z',
          }),
        ),
      )
      await renderShell()
      const card = within(rightRail().getByRole('region', { name: 'Your profile' }))

      expect(await card.findByText('Counting engines.')).toBeInTheDocument()
      expect(card.queryByText('No bio yet.')).not.toBeInTheDocument()
    })

    it('hides "Who to follow" when there is nobody to suggest (default handlers)', async () => {
      await renderShell()
      await within(rightRail().getByRole('region', { name: 'Your profile' })).findByText(
        'No bio yet.',
      )

      await waitFor(() =>
        expect(
          rightRail().queryByRole('region', { name: 'Who to follow' }),
        ).not.toBeInTheDocument(),
      )
    })

    it('shows "Who to follow" suggestions with Follow buttons', async () => {
      server.use(
        http.get(apiUrl('/users/me/suggestions'), () =>
          HttpResponse.json({
            items: [{ username: 'grace', bio: null, isFollowing: false, followsYou: false }],
          }),
        ),
      )
      await renderShell()

      const link = await rightRail().findByRole('link', { name: '@grace' })
      const card = within(rightRail().getByRole('region', { name: 'Who to follow' }))
      expect(link).toHaveAttribute('href', '/u/grace')
      expect(card.getByRole('button', { name: 'Follow @grace' })).toBeInTheDocument()
      expect(card.queryByText('Coming soon')).not.toBeInTheDocument()
    })

    it('shows the search box as an editable combobox', async () => {
      await renderShell()

      const search = rightRail().getByRole('combobox', { name: 'Search' })
      expect(search).not.toHaveAttribute('readonly')
      expect(search).not.toHaveAttribute('aria-disabled')
    })

    // AC5: the rail scrolls (`overflow-y-auto`, which clips on both axes), so it needs inline
    // padding for the search box's 3px focus ring (and the typeahead panel) not to be cut off.
    it('pads the scrolling rail so its edges do not clip the focus ring', async () => {
      await renderShell()

      const rail = screen.getByRole('complementary', { name: 'Sidebar' })
      expect(rail).toHaveClass('overflow-y-auto', 'px-2', 'w-[366px]')
    })
  })

  describe('mobile', () => {
    it('shows Home, Explore, Notifications, Profile and Sign out in the bottom bar', async () => {
      await renderShell()
      const nav = mobileNav()

      const labels = [...screen.getByRole('navigation', { name: 'Primary (mobile)' }).children].map(
        (item) => item.getAttribute('aria-label'),
      )
      expect(labels).toEqual(['Home', 'Explore', 'Notifications', 'Profile', 'Sign out'])

      expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
      expect(nav.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/u/ada')
      expect(nav.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/sign-out')
      expect(nav.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore')
      expect(nav.getByRole('link', { name: 'Notifications' })).toHaveAttribute(
        'href',
        '/notifications',
      )
    })

    it('renders the compose button as an enabled "New post" button', async () => {
      await renderShell()

      const buttons = screen.getAllByRole('button', { name: 'New post' })
      expect(buttons).toHaveLength(2) // left rail + mobile compose button
      for (const button of buttons) {
        expect(button).toBeEnabled()
        expect(button).not.toHaveAttribute('aria-disabled')
      }
    })
  })

  describe('unread notifications badge', () => {
    const navs: [string, typeof primaryNav][] = [
      ['left rail', primaryNav],
      ['bottom bar', mobileNav],
    ]

    it.each(navs)('shows the unread count on Notifications and in its name (%s)', async (_label, nav) => {
      withUnreadCount(3)
      await renderShell()

      const link = await nav().findByRole('link', { name: 'Notifications, 3 unread' })
      expect(link).toHaveAttribute('href', '/notifications')
      const badge = link.querySelector('[data-slot="badge"]')
      expect(badge).toHaveTextContent('3')
      expect(badge).toHaveAttribute('aria-hidden', 'true')
    })

    it.each(navs)('caps the badge at 99+ but keeps the exact count in the name (%s)', async (_label, nav) => {
      withUnreadCount(150)
      await renderShell()

      const link = await nav().findByRole('link', { name: 'Notifications, 150 unread' })
      expect(link.querySelector('[data-slot="badge"]')).toHaveTextContent('99+')
    })

    it('updates the badge from a notifications.changed push, with no request', async () => {
      const uninstall = installFakeEventSource()
      try {
        let countRequests = 0
        server.use(
          http.get(apiUrl('/notifications/unread-count'), () => {
            countRequests += 1
            return HttpResponse.json({ count: 1 })
          }),
        )
        await renderShell()
        await primaryNav().findByRole('link', { name: 'Notifications, 1 unread' })
        expect(FakeEventSource.instances).toHaveLength(1)
        FakeEventSource.latest.open()

        FakeEventSource.latest.emit('notifications.changed', { unreadCount: 4 })

        for (const nav of [primaryNav, mobileNav]) {
          expect(
            await nav().findByRole('link', { name: 'Notifications, 4 unread' }),
          ).toBeInTheDocument()
        }
        expect(countRequests).toBe(1)
      } finally {
        uninstall()
      }
    })

    it('shows no badge when the count cannot be loaded', async () => {
      server.use(
        http.get(apiUrl('/notifications/unread-count'), () =>
          HttpResponse.json({ message: 'Boom' }, { status: 500 }),
        ),
      )
      const { queryClient } = await renderShell()

      // Wait for the 500 to settle (the query in error), so this doesn't pass during loading.
      await waitFor(() =>
        expect(queryClient.getQueryState(notificationKeys.unreadCount())?.status).toBe('error'),
      )
      for (const nav of [primaryNav(), mobileNav()]) {
        const link = nav.getByRole('link', { name: 'Notifications' })
        expect(link).toHaveAccessibleName('Notifications')
        expect(link.querySelector('[data-slot="badge"]')).toBeNull()
      }
    })
  })

  it('has a skip link to the focusable #main-content', async () => {
    await renderShell()

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    )
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(within(main).getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
  })

  it('marks Profile active after navigating to /u/ada', async () => {
    const { user } = await renderShell()

    await user.click(primaryNav().getByRole('link', { name: 'Profile' }))

    expect(
      await within(screen.getByRole('main')).findByRole('heading', { level: 1, name: '@ada' }),
    ).toBeInTheDocument()
    expect(primaryNav().getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
    expect(primaryNav().getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(mobileNav().getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
  })

  it('marks Profile active when opened at /u/ada', async () => {
    await renderShell('/u/ada')

    expect(primaryNav().getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
    expect(primaryNav().getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  describe('New post', () => {
    it.each([
      ['left rail', () => leftRail().getByRole('button', { name: 'New post' })],
      ['mobile compose button', () => screen.getAllByRole('button', { name: 'New post' })[1]],
    ])('goes Home from /u/ada and focuses the composer (%s)', async (_label, getButton) => {
      const { user } = await renderShellWithProbe('/u/ada')
      await within(screen.getByRole('main')).findByRole('heading', { level: 1, name: '@ada' })

      await user.click(getButton())

      expect(
        await within(screen.getByRole('main')).findByRole('heading', { level: 1, name: 'Home' }),
      ).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/')
      await waitFor(() => expect(composerTextbox()).toHaveFocus())
    })

    it('on Home, focuses the composer right away without navigating', async () => {
      const { user } = await renderShellWithProbe('/')
      const keyBefore = screen.getByTestId('location').dataset.key
      expect(composerTextbox()).not.toHaveFocus()

      await user.click(leftRail().getByRole('button', { name: 'New post' }))

      expect(composerTextbox()).toHaveFocus()
      expect(screen.getByTestId('location').dataset.key).toBe(keyBefore)
    })
  })
})
