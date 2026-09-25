import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { useLocation, useNavigationType } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import type { FollowUser } from '@/lib/api/types'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

const row = (username: string, overrides: Partial<FollowUser> = {}): FollowUser => ({
  username,
  displayName: null,
  bio: null,
  isFollowing: false,
  followsYou: false,
  ...overrides,
})

// Exposes the current location (path + search) and how we got there (PUSH / REPLACE / POP).
function LocationDisplay() {
  const location = useLocation()
  const navigationType = useNavigationType()
  return (
    <p data-testid="location" data-type={navigationType}>
      {location.pathname}
      {location.search}
    </p>
  )
}

// Renders the app at `route` and waits for the shell (auth resolves first).
async function renderExplore(route = '/explore') {
  const utils = renderWithProviders(
    <>
      <AppRouter />
      <LocationDisplay />
    </>,
    { route },
  )
  await screen.findByRole('main')
  return utils
}

const main = () => within(screen.getByRole('main'))
const searchBox = () => main().getByRole('searchbox', { name: 'Search users' })
const location = () => screen.getByTestId('location')

// Serves `GET /search/users`: `pages` is a list of pages (page i → `nextCursor: 'c<i+1>'`, the last
// `null`), whatever the query. `state.requests` lists the requested `q`s, `state.status` forces an
// error status for the next requests.
function mockSearch(pages: FollowUser[][] = [[]]) {
  const state: { status: number; requests: (string | null)[] } = { status: 200, requests: [] }
  server.use(
    http.get(apiUrl('/search/users'), ({ request }) => {
      const params = new URL(request.url).searchParams
      state.requests.push(params.get('q'))
      if (state.status !== 200) {
        return HttpResponse.json({ message: 'Server error' }, { status: state.status })
      }
      const cursor = params.get('cursor')
      const index = cursor ? Number(cursor.slice(1)) : 0
      return HttpResponse.json({
        items: pages[index],
        nextCursor: index + 1 < pages.length ? `c${index + 1}` : null,
      })
    }),
  )
  return state
}

describe('Explore', () => {
  it('prompts for a query when there is none, with the search box focused', async () => {
    const state = mockSearch()
    await renderExplore()

    expect(
      await screen.findByText('Search for people by name or username'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Explore' })).toBeInTheDocument()
    expect(searchBox()).toHaveValue('')
    expect(searchBox()).toHaveFocus()
    expect(state.requests).toEqual([])
  })

  it('searches ?q= right away and lists the matches with links and follow buttons', async () => {
    const state = mockSearch([
      [
        row('bob', { displayName: 'Bob Builder', bio: 'Can we fix it?' }),
        row('carol', { followsYou: true }),
        row('dave', { isFollowing: true }),
      ],
    ])
    await renderExplore('/explore?q=ada')

    const link = await main().findByRole('link', { name: 'Bob Builder @bob' })
    expect(link).toHaveAttribute('href', '/u/bob')
    expect(searchBox()).toHaveValue('ada')
    expect(searchBox()).not.toHaveFocus()
    expect(state.requests).toEqual(['ada'])

    expect(main().getByText('Can we fix it?')).toBeInTheDocument()
    expect(main().getByRole('link', { name: '@carol' })).toHaveAttribute('href', '/u/carol')
    expect(main().getByRole('button', { name: 'Follow @bob' })).toHaveTextContent('Follow')
    expect(main().getByRole('button', { name: 'Follow back @carol' })).toHaveTextContent(
      'Follow back',
    )
    expect(main().getByRole('button', { name: 'Unfollow @dave' })).toHaveTextContent('Following')
    expect(main().getByText("That's everyone matching “ada”")).toBeInTheDocument()
  })

  it("shows no follow button on the signed-in user's own row", async () => {
    mockSearch([[row('ADA', { bio: 'me' }), row('adam')]])
    await renderExplore('/explore?q=ad')

    expect(await main().findByRole('link', { name: '@ADA' })).toBeInTheDocument()
    expect(main().queryByRole('button', { name: /@ADA$/ })).not.toBeInTheDocument()
    expect(main().getByRole('button', { name: 'Follow @adam' })).toBeInTheDocument()
  })

  it('updates ?q= (replacing the entry) after typing, keeping other params, and searches', async () => {
    const state = mockSearch([[row('grace')]])
    const { user } = await renderExplore('/explore?ref=nav')
    await screen.findByText('Search for people by name or username')

    await user.type(searchBox(), 'gra')

    await waitFor(() => expect(location()).toHaveTextContent('/explore?ref=nav&q=gra'))
    expect(location()).toHaveAttribute('data-type', 'REPLACE')
    expect(await main().findByRole('link', { name: '@grace' })).toBeInTheDocument()
    // Debounced: one search for the settled query, not one per keystroke.
    expect(state.requests).toEqual(['gra'])
  })

  it('removes q from the URL when the input is cleared', async () => {
    mockSearch([[row('grace')]])
    const { user } = await renderExplore('/explore?q=gra&ref=nav')
    await main().findByRole('link', { name: '@grace' })

    await user.clear(searchBox())

    await waitFor(() => expect(location()).toHaveTextContent(/^\/explore\?ref=nav$/))
    expect(location()).toHaveAttribute('data-type', 'REPLACE')
    expect(await screen.findByText('Search for people by name or username')).toBeInTheDocument()
  })

  it('shows an empty state when nobody matches', async () => {
    mockSearch([[]])
    await renderExplore('/explore?q=%40zed')

    expect(await screen.findByText('No users match “zed”')).toBeInTheDocument()
    expect(main().queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })

  it('shows an error with Retry when the search fails, and recovers', async () => {
    const state = mockSearch([[row('grace')]])
    state.status = 500
    const { user } = await renderExplore('/explore?q=gra')

    expect(await screen.findByText(/Couldn't search users/)).toBeInTheDocument()

    state.status = 200
    await user.click(main().getByRole('button', { name: 'Retry' }))

    expect(await main().findByRole('link', { name: '@grace' })).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't search users/)).not.toBeInTheDocument()
  })

  it('loads the next page', async () => {
    const state = mockSearch([[row('bob')], [row('carol')]])
    const { user } = await renderExplore('/explore?q=o')

    await main().findByRole('link', { name: '@bob' })
    expect(main().queryByText(/That's everyone/)).not.toBeInTheDocument()

    await user.click(main().getByRole('button', { name: 'Load more' }))

    expect(await main().findByRole('link', { name: '@carol' })).toBeInTheDocument()
    expect(main().getByText('That\'s everyone matching “o”')).toBeInTheDocument()
    expect(state.requests).toEqual(['o', 'o'])
  })
})
