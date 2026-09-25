import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RightRail } from '@/components/layout/RightRail'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { FollowUser } from '@/lib/api/types'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

// A suggestion as the API sends it (`displayName` left out unless a test sets it).
type Suggestion = Omit<FollowUser, 'displayName'> & Partial<Pick<FollowUser, 'displayName'>>

const SUGGESTIONS: Suggestion[] = [
  { username: 'grace', bio: 'Compilers and nanoseconds.', isFollowing: false, followsYou: false },
  { username: 'linus', bio: null, isFollowing: false, followsYou: true },
]

function mockSuggestions(items: Suggestion[] = SUGGESTIONS) {
  server.use(http.get(apiUrl('/users/me/suggestions'), () => HttpResponse.json({ items })))
}

// Rendered inside a TooltipProvider, like in AppShell.
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
    let releaseFollow: (() => void) | undefined
    const requests: string[] = []
    server.use(
      http.get(apiUrl('/users/me/suggestions'), () =>
        HttpResponse.json({
          items: followedGrace ? SUGGESTIONS.filter((s) => s.username !== 'grace') : SUGGESTIONS,
        }),
      ),
      http.put(apiUrl('/users/:username/follow'), async ({ params }) => {
        requests.push(`PUT ${params.username}`)
        await new Promise<void>((resolve) => {
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
    releaseFollow!()
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

describe('RightRail display names', () => {
  it('shows display names in Who to follow, keeping @username in the link name', async () => {
    mockSuggestions([
      { ...SUGGESTIONS[0], displayName: 'Grace Hopper' },
      SUGGESTIONS[1],
    ])
    renderRail()

    const grace = await whoToFollow().findByRole('link', { name: 'Grace Hopper @grace' })
    expect(grace).toHaveAttribute('href', '/u/grace')
    expect(within(grace).getByText('Grace Hopper')).toHaveClass('font-semibold')
    expect(within(grace).getByText('@grace')).toHaveClass('text-muted-foreground')
    expect(whoToFollow().getByRole('link', { name: '@linus' })).toBeInTheDocument()
  })

  it("shows the signed-in user's display name on the profile card", async () => {
    server.use(
      http.get(apiUrl('/users/:username'), () =>
        HttpResponse.json({
          username: 'ada',
          displayName: 'Ada Lovelace',
          bio: null,
          createdAt: '2026-09-15T12:00:00.000Z',
        }),
      ),
    )
    renderRail()

    await waitForProfileCard()
    const card = within(screen.getByRole('region', { name: 'Your profile' }))
    expect(card.getByText('Ada Lovelace')).toHaveClass('font-semibold')
    expect(card.getByText('@ada')).toHaveClass('text-muted-foreground')
  })

  it('shows just @username on the profile card without a display name', async () => {
    renderRail()

    await waitForProfileCard()
    const card = within(screen.getByRole('region', { name: 'Your profile' }))
    expect(card.getByText('@ada')).toHaveClass('font-mono', 'text-muted-foreground')
    expect(card.getByText('@ada')).not.toHaveClass('font-semibold')
  })
})

describe('RightRail search typeahead', () => {
  const RESULTS: FollowUser[] = [
    { username: 'grace', displayName: 'Grace Hopper', bio: 'Compilers.', isFollowing: false, followsYou: false },
    { username: 'graham', displayName: null, bio: null, isFollowing: true, followsYou: false },
  ]

  // Answers `GET /search/users` with `items` (or `respond`), recording each request's query string.
  interface MockSearchOptions {
    items?: FollowUser[]
    respond?: () => Response
  }

  function mockSearch({ items = RESULTS, respond }: MockSearchOptions = {}) {
    const requests: { q: string | null; limit: string | null }[] = []
    server.use(
      http.get(apiUrl('/search/users'), ({ request }) => {
        const url = new URL(request.url)
        requests.push({ q: url.searchParams.get('q'), limit: url.searchParams.get('limit') })
        return respond ? respond() : HttpResponse.json({ items, nextCursor: null })
      }),
    )
    return requests
  }

  // Shows where the app navigated to (path + query string).
  function LocationProbe() {
    const location = useLocation()
    return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  }

  const renderSearch = () =>
    renderWithProviders(
      <TooltipProvider>
        <RightRail />
        <LocationProbe />
      </TooltipProvider>,
    )

  const searchBox = () => screen.getByRole('combobox', { name: 'Search' })
  const location = () => screen.getByTestId('location')

  async function typeAndWaitForResults(user: UserEvent, text = 'gr') {
    await user.type(searchBox(), text)
    await screen.findByRole('option', { name: 'Grace Hopper @grace' })
  }

  it('is an editable combobox, collapsed until there is something to search', async () => {
    renderSearch()

    const input = searchBox()
    expect(input).not.toHaveAttribute('readonly')
    expect(input).not.toHaveAttribute('aria-disabled')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
  })

  it('shows a loading row, then up to 5 matching users after the debounce', async () => {
    const requests = mockSearch()
    const { user } = renderSearch()

    await user.type(searchBox(), 'gr')

    const listbox = screen.getByRole('listbox', { name: 'Search results' })
    expect(searchBox()).toHaveAttribute('aria-expanded', 'true')
    expect(searchBox()).toHaveAttribute('aria-controls', listbox.id)
    expect(screen.getByTestId('search-status')).toHaveTextContent('Searching…')

    const grace = await within(listbox).findByRole('option', { name: 'Grace Hopper @grace' })
    expect(grace).toHaveAttribute('href', '/u/grace')
    expect(within(grace).getByText('Compilers.')).toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: '@graham' })).toHaveAttribute(
      'href',
      '/u/graham',
    )
    const options = within(listbox).getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[2]).toHaveTextContent('See all results for “gr”')
    expect(within(listbox).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTestId('search-status')).toHaveTextContent('')

    // Debounced: one request for the settled query, with the typeahead limit.
    expect(requests).toEqual([{ q: 'gr', limit: '5' }])
  })

  it('moves the active option with the arrow keys and opens the profile on Enter', async () => {
    mockSearch()
    const { user } = renderSearch()
    await typeAndWaitForResults(user)

    await user.keyboard('{ArrowDown}{ArrowDown}')
    const graham = screen.getByRole('option', { name: '@graham' })
    expect(searchBox()).toHaveAttribute('aria-activedescendant', graham.id)
    expect(graham).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Grace Hopper @grace' })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    await user.keyboard('{Enter}')

    expect(location()).toHaveTextContent('/u/graham')
    expect(searchBox()).toHaveValue('')
    expect(searchBox()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('wraps around the options, "See all results" included', async () => {
    mockSearch()
    const { user } = renderSearch()
    await typeAndWaitForResults(user)

    // Up from nothing lands on the last option ("See all results"); down from there wraps to the top.
    await user.keyboard('{ArrowUp}')
    const seeAll = screen.getByRole('option', { name: 'See all results for “gr”' })
    expect(searchBox()).toHaveAttribute('aria-activedescendant', seeAll.id)
    await user.keyboard('{ArrowDown}')
    expect(searchBox()).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Grace Hopper @grace' }).id,
    )

    await user.keyboard('{ArrowUp}{Enter}')
    expect(location()).toHaveTextContent('/explore?q=gr')
  })

  it('goes to Explore with the query on Enter when no option is active', async () => {
    mockSearch()
    const { user } = renderSearch()
    await user.type(searchBox(), '@gr ')

    await user.keyboard('{Enter}')

    expect(location()).toHaveTextContent('/explore?q=gr')
    expect(searchBox()).toHaveValue('')
  })

  it('navigates when an option is clicked', async () => {
    mockSearch()
    const { user } = renderSearch()
    await typeAndWaitForResults(user)

    await user.click(screen.getByRole('option', { name: 'Grace Hopper @grace' }))

    expect(location()).toHaveTextContent('/u/grace')
    expect(searchBox()).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('goes to Explore when "See all results" is clicked', async () => {
    mockSearch()
    const { user } = renderSearch()
    await typeAndWaitForResults(user, 'Grace H')

    await user.click(screen.getByRole('option', { name: 'See all results for “Grace H”' }))

    expect(location()).toHaveTextContent('/explore?q=Grace%20H')
  })

  it('closes on the first Escape and clears the input on the second', async () => {
    mockSearch()
    const { user } = renderSearch()
    await typeAndWaitForResults(user)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(searchBox()).toHaveAttribute('aria-expanded', 'false')
    expect(searchBox()).toHaveValue('gr')
    expect(searchBox()).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(searchBox()).toHaveValue('')

    // Typing again reopens it.
    await typeAndWaitForResults(user)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('closes when clicking outside or tabbing away', async () => {
    mockSearch()
    const { user } = renderSearch()
    await typeAndWaitForResults(user)

    await user.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // Focusing the input again reopens it with the same query.
    await user.click(searchBox())
    expect(await screen.findByRole('listbox')).toBeInTheDocument()

    await user.tab()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(searchBox()).not.toHaveFocus()
  })

  it('says "No users found" when nothing matches', async () => {
    mockSearch({ items: [] })
    const { user } = renderSearch()

    await user.type(searchBox(), 'zzz')

    expect(await screen.findByText('No users found')).toBeInTheDocument()
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveAccessibleName('See all results for “zzz”')
  })

  it('shows a quiet error line when the search fails', async () => {
    mockSearch({ respond: () => HttpResponse.json({ message: 'Boom' }, { status: 500 }) })
    const { user } = renderSearch()

    await user.type(searchBox(), 'gr')

    expect(await screen.findByText('Couldn’t load results.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'See all results for “gr”' })).toBeInTheDocument()
  })

  it('does not search or open for an @-only input', async () => {
    const requests = mockSearch()
    const { user } = renderSearch()

    await user.type(searchBox(), '@')
    await user.keyboard('{ArrowDown}{Enter}')
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(requests).toEqual([])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(searchBox()).toHaveAttribute('aria-expanded', 'false')
    expect(location()).toHaveTextContent(/^\/$/)
  })
})
