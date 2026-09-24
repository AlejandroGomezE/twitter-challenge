import { http, HttpResponse } from 'msw'
import { screen, within } from '@testing-library/react'
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

    it('shows the "Coming soon" items and New post as aria-disabled buttons, not links', async () => {
      await renderShell()
      const rail = leftRail()

      for (const name of [...COMING_SOON_NAV, 'New post']) {
        const button = rail.getByRole('button', { name })
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).not.toHaveAttribute('href')
        expect(rail.queryByRole('link', { name })).not.toBeInTheDocument()
      }
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

    it('shows "Who to follow" as coming soon, with no suggested users', async () => {
      await renderShell()
      const card = within(rightRail().getByRole('region', { name: 'Who to follow' }))

      expect(card.getByText('Coming soon')).toBeInTheDocument()
      expect(card.queryAllByRole('img')).toHaveLength(0)
      expect(card.queryAllByRole('link')).toHaveLength(0)
      expect(card.queryAllByRole('button')).toHaveLength(0)
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

    it('renders the compose button as an aria-disabled "New post" button', async () => {
      await renderShell()

      const buttons = screen.getAllByRole('button', { name: 'New post' })
      expect(buttons).toHaveLength(2) // left rail + mobile compose button
      for (const button of buttons) {
        expect(button).toHaveAttribute('aria-disabled', 'true')
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
})
