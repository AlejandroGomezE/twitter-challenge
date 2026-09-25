import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
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

async function renderShellWithProbe(route) {
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

const COMING_SOON_NAV = ['Explore', 'Notifications', 'Messages', 'Bookmarks']

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

    it('shows the "Coming soon" items as aria-disabled buttons, not links', async () => {
      await renderShell()
      const rail = leftRail()

      for (const name of COMING_SOON_NAV) {
        const button = rail.getByRole('button', { name })
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).not.toHaveAttribute('href')
        expect(rail.queryByRole('link', { name })).not.toBeInTheDocument()
      }
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

    it('shows the search box as a read-only, aria-disabled input', async () => {
      await renderShell()

      const search = rightRail().getByRole('searchbox', { name: 'Search' })
      expect(search).toHaveAttribute('readonly')
      expect(search).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('mobile', () => {
    it('shows Home, Explore, Notifications, Messages, Profile and Sign out in the bottom bar', async () => {
      await renderShell()
      const nav = mobileNav()

      const labels = [...screen.getByRole('navigation', { name: 'Primary (mobile)' }).children].map(
        (item) => item.getAttribute('aria-label'),
      )
      expect(labels).toEqual(['Home', 'Explore', 'Notifications', 'Messages', 'Profile', 'Sign out'])

      expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
      expect(nav.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/u/ada')
      expect(nav.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/sign-out')
      for (const name of ['Explore', 'Notifications', 'Messages']) {
        expect(nav.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
        expect(nav.queryByRole('link', { name })).not.toBeInTheDocument()
      }
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
