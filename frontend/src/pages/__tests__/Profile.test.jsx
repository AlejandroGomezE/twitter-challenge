import { http, HttpResponse } from 'msw'
import { getDefaultNormalizer, screen, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

// Mid-month so the formatted month doesn't depend on the test machine's timezone.
const CREATED_AT = '2026-09-15T12:00:00.000Z'

const PROFILES = {
  ada: { username: 'ada', bio: 'Math & engines', createdAt: CREATED_AT },
  grace: { username: 'grace', bio: null, createdAt: CREATED_AT },
}

function LocationDisplay() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

function renderApp(route) {
  return renderWithProviders(
    <>
      <AppRouter />
      <LocationDisplay />
    </>,
    { route },
  )
}

// Serves `GET /users/:username` (case-insensitive) from `profiles`; `state.status` forces an error
// status for the next requests. `state.requests` lists the requested usernames.
function mockProfiles(profiles = PROFILES) {
  const state = { status: 200, requests: [] }
  server.use(
    http.get(apiUrl('/users/:username'), ({ params }) => {
      state.requests.push(params.username)
      if (state.status !== 200) {
        return HttpResponse.json({ message: 'Server error' }, { status: state.status })
      }
      const profile = profiles[params.username.toLowerCase()]
      if (!profile) return HttpResponse.json({ message: 'User not found' }, { status: 404 })
      return HttpResponse.json(profile)
    }),
  )
  return state
}

describe('Profile', () => {
  it('shows a loading state while the profile is being fetched', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let requested
    const received = new Promise((resolve) => {
      requested = resolve
    })
    server.use(
      http.get(apiUrl('/users/:username'), async () => {
        requested()
        await gate
        return HttpResponse.json(PROFILES.ada)
      }),
    )

    renderApp('/u/ada')
    // The request only starts once ProtectedRoute has resolved `me` and Profile has mounted.
    await received

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '@ada' })).not.toBeInTheDocument()

    release()

    expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })

  it('shows the avatar, @username, bio and join date', async () => {
    mockProfiles()

    renderApp('/u/ada')

    expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
    // Scoped to the page: the app shell also shows the signed-in user's (ada's) avatar and bio.
    const page = within(screen.getByRole('main'))
    expect(page.getByRole('img', { name: '@ada' })).toHaveTextContent('A')
    expect(page.getByText('Math & engines')).toBeInTheDocument()
    expect(page.getByText('Joined September 2026')).toBeInTheDocument()
    expect(page.queryByText('No bio yet.')).not.toBeInTheDocument()
    expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    expect(page.getByRole('tab', { name: 'Posts' })).toHaveAttribute('aria-selected', 'true')
    expect(page.getByText('No posts yet')).toBeInTheDocument()
  })

  it('renders the bio as plain text, keeping line breaks and never interpreting HTML', async () => {
    const bio = 'Line one\n<b>not bold</b>'
    mockProfiles({ ada: { ...PROFILES.ada, bio } })

    const { container } = renderApp('/u/ada')

    // Scoped to the page: the app shell's profile card shows the same (signed-in user's) bio.
    const bioElement = await within(await screen.findByRole('main')).findByText(bio, {
      normalizer: getDefaultNormalizer({ trim: false, collapseWhitespace: false }),
    })
    expect(bioElement.textContent).toBe(bio)
    expect(bioElement).toHaveClass('whitespace-pre-wrap')
    expect(container.querySelector('b')).toBeNull()
  })

  it('shows an empty-bio hint when there is no bio', async () => {
    mockProfiles()

    renderApp('/u/grace')

    expect(await screen.findByRole('heading', { name: '@grace' })).toBeInTheDocument()
    expect(screen.getByText('No bio yet.')).toBeInTheDocument()
  })

  it.each(['/u/ada', '/u/ADA'])('shows an Edit profile link on your own profile (%s)', async (route) => {
    mockProfiles()

    renderApp(route)

    expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/settings/profile')
  })

  it.each(['/u/grace', '/u/Grace', '/u/GRACE'])(
    "does not show Edit profile on another user's profile (%s)",
    async (route) => {
      mockProfiles()

      renderApp(route)

      expect(await screen.findByRole('heading', { name: '@grace' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Edit profile' })).not.toBeInTheDocument()
    },
  )

  it('shows "User not found" with a link home for an unknown username, without retrying', async () => {
    const profiles = mockProfiles()

    renderApp('/u/ghost')

    expect(await screen.findByText('User not found')).toBeInTheDocument()
    expect(screen.getByText('There is no user called @ghost.')).toBeInTheDocument()
    // Two ways home: the header's back button and the empty state's link (same accessible name).
    const homeLinks = screen.getAllByRole('link', { name: 'Back to home' })
    expect(homeLinks).toHaveLength(2)
    for (const link of homeLinks) expect(link).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    // The app shell's profile card also loads the signed-in user (ada); only count @ghost here.
    expect(profiles.requests.filter((username) => username === 'ghost')).toEqual(['ghost'])
  })

  it('shows a friendly error on a server failure and recovers on Retry', async () => {
    const profiles = mockProfiles()
    profiles.status = 500

    const { user } = renderApp('/u/ada')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load this profile. Check your connection and try again.",
    )
    expect(screen.queryByText('User not found')).not.toBeInTheDocument()

    profiles.status = 200
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
  })
})
