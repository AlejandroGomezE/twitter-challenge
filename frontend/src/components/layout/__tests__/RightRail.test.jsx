import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RightRail } from '@/components/layout/RightRail'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

const SUGGESTIONS = [
  { username: 'grace', bio: 'Compilers and nanoseconds.', isFollowing: false, followsYou: false },
  { username: 'linus', bio: null, isFollowing: false, followsYou: true },
]

function mockSuggestions(items = SUGGESTIONS) {
  server.use(http.get(apiUrl('/users/me/suggestions'), () => HttpResponse.json({ items })))
}

// The search box is a ComingSoon placeholder, which needs a TooltipProvider (AppShell has one).
const renderRail = () =>
  renderWithProviders(
    <TooltipProvider>
      <RightRail />
    </TooltipProvider>,
  )

const whoToFollow = () => within(screen.getByRole('region', { name: 'Who to follow' }))

// Waits until the rail has settled: the profile card shows (after /auth/me) and its bio query ended.
async function waitForProfileCard() {
  const card = within(await screen.findByRole('region', { name: 'Your profile' }))
  await card.findByText('No bio yet.')
}

describe('RightRail "Who to follow"', () => {
  it('lists the suggestions, each linking to the profile, with a Follow button', async () => {
    mockSuggestions()
    renderRail()

    const grace = await screen.findByRole('link', { name: '@grace' })
    const card = whoToFollow()
    expect(grace).toHaveAttribute('href', '/u/grace')
    expect(card.getByText('Compilers and nanoseconds.')).toBeInTheDocument()
    expect(card.getByRole('link', { name: '@linus' })).toHaveAttribute('href', '/u/linus')
    expect(card.getByRole('img', { name: '@grace' })).toBeInTheDocument()

    expect(card.getByRole('button', { name: 'Follow @grace' })).toHaveTextContent(/^Follow$/)
    expect(card.getByRole('button', { name: 'Follow back @linus' })).toBeInTheDocument()
    expect(card.queryByText('Coming soon')).not.toBeInTheDocument()
  })

  it('sends PUT on Follow and flips the button to "Following" until the refetch drops the row', async () => {
    let followedGrace = false
    let releaseFollow
    const requests = []
    server.use(
      http.get(apiUrl('/users/me/suggestions'), () =>
        HttpResponse.json({
          items: followedGrace ? SUGGESTIONS.filter((s) => s.username !== 'grace') : SUGGESTIONS,
        }),
      ),
      http.put(apiUrl('/users/:username/follow'), async ({ params }) => {
        requests.push(`PUT ${params.username}`)
        await new Promise((resolve) => {
          releaseFollow = resolve
        })
        followedGrace = true
        return HttpResponse.json({ following: true, followerCount: 1 })
      }),
    )
    const { user } = renderRail()

    await user.click(await screen.findByRole('button', { name: 'Follow @grace' }))

    // Optimistic: the button flips while the request is in flight.
    const button = await whoToFollow().findByRole('button', { name: 'Unfollow @grace' })
    expect(button).toHaveTextContent(/^(Following|Unfollow)$/)
    await waitFor(() => expect(requests).toEqual(['PUT grace']))

    // Once it succeeds, the suggestions refetch replaces the row.
    releaseFollow()
    await waitFor(() =>
      expect(whoToFollow().queryByRole('link', { name: '@grace' })).not.toBeInTheDocument(),
    )
    expect(whoToFollow().getByRole('link', { name: '@linus' })).toBeInTheDocument()
  })

  it('shows skeleton rows while the suggestions load', async () => {
    server.use(http.get(apiUrl('/users/me/suggestions'), () => new Promise(() => {})))
    renderRail()

    const region = await screen.findByRole('region', { name: 'Who to follow' })
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(within(region).getAllByTestId('suggestion-skeleton')).toHaveLength(3)
    expect(within(region).queryAllByRole('link')).toHaveLength(0)
    expect(within(region).queryAllByRole('button')).toHaveLength(0)
  })

  it('hides the card when there is nobody to suggest', async () => {
    mockSuggestions([])
    renderRail()

    await waitForProfileCard()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Who to follow' })).not.toBeInTheDocument(),
    )
  })

  it('hides the card when the suggestions request fails', async () => {
    server.use(
      http.get(apiUrl('/users/me/suggestions'), () =>
        HttpResponse.json({ message: 'Boom' }, { status: 500 }),
      ),
    )
    renderRail()

    await waitForProfileCard()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Who to follow' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
