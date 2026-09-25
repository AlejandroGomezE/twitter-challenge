import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { Home } from '../Home'

// Shows the router's current `location.state`, to check Home clears it.
function LocationState() {
  const location = useLocation()
  return <output data-testid="location-state">{JSON.stringify(location.state)}</output>
}

// The AppShell provides the TooltipProvider the "Coming soon" tab needs.
const renderHome = (route = '/') =>
  renderWithProviders(
    <TooltipProvider>
      <Home />
      <LocationState />
    </TooltipProvider>,
    { route },
  )

const post = (id, overrides = {}) => ({
  id,
  body: `post ${id}`,
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'ada' },
  likeCount: 0,
  commentCount: 0,
  likedByMe: false,
  ...overrides,
})

// `GET /feed` serving `pages` in order: page i is `{ items: pages[i], nextCursor: 'c<i+1>' }`, the
// last with `nextCursor: null`. The cursor picks the page.
function mockFeed(pages) {
  server.use(
    http.get(apiUrl('/feed'), ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      const index = cursor ? Number(cursor.slice(1)) : 0
      return HttpResponse.json({
        items: pages[index],
        nextCursor: index < pages.length - 1 ? `c${index + 1}` : null,
      })
    }),
  )
}

const main = () => screen.getByRole('tabpanel', { name: 'For you' })
const composer = () => screen.getByRole('textbox', { name: 'Compose a new post' })

describe('Home', () => {
  it('shows the "Home" header with For you selected and Following coming soon', () => {
    renderHome()

    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(screen.getByText('created by Alejandro Gomez')).toBeInTheDocument()

    const tablist = screen.getByRole('tablist', { name: 'Feed' })
    const forYou = within(tablist).getByRole('tab', { name: 'For you' })
    const following = within(tablist).getByRole('tab', { name: 'Following' })
    expect(forYou).toHaveAttribute('aria-selected', 'true')
    expect(following).toHaveAttribute('aria-selected', 'false')
    expect(following).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('tabpanel', { name: 'For you' })).toBeInTheDocument()
  })

  // fireEvent (no focus/pointer move) so the Radix tooltip, which needs ResizeObserver, stays shut.
  it('makes Following an aria-disabled tab whose activation is prevented', () => {
    renderHome()
    const following = screen.getByRole('tab', { name: 'Following' })

    expect(following).toHaveAttribute('aria-disabled', 'true')
    expect(following).not.toHaveAttribute('aria-controls')
    // fireEvent returns false when a handler called preventDefault() (ComingSoon's guard).
    expect(fireEvent.click(following)).toBe(false)
    expect(following).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: 'For you' })).toBeInTheDocument()
  })

  it('shows an enabled composer with a 0/280 counter and a disabled Post button', async () => {
    renderHome()

    expect(await screen.findByRole('img', { name: '@ada' })).toBeInTheDocument()

    const textarea = screen.getByRole('textbox', { name: 'Compose a new post' })
    expect(textarea).toBeEnabled()
    expect(textarea).toHaveAccessibleDescription('0/280')
    expect(screen.queryByText('Posting is coming soon')).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    for (const name of ['Add an image', 'Add an emoji', 'Schedule post', 'Add a location']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
  })

  it('shows the empty state when the feed has no posts', async () => {
    renderHome()

    expect(await screen.findByRole('heading', { name: 'No posts yet' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your posts and posts from people you follow will show up here. Write your first one above.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument()
  })

  describe('feed', () => {
    it('renders the feed posts as post cards, newest first as served', async () => {
      mockFeed([[post('p2', { body: 'Second thoughts' }), post('p1', { body: 'First light' })]])
      renderHome()

      const articles = await within(main()).findAllByRole('article')
      expect(articles).toHaveLength(2)
      expect(articles[0]).toHaveTextContent('Second thoughts')
      expect(articles[1]).toHaveTextContent('First light')
      expect(within(articles[0]).getByRole('link', { name: '@ada' })).toHaveAttribute('href', '/u/ada')
      expect(screen.queryByRole('heading', { name: 'No posts yet' })).not.toBeInTheDocument()
    })

    it('shows loading skeletons until the feed arrives', async () => {
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      server.use(
        http.get(apiUrl('/feed'), async () => {
          await gate
          return HttpResponse.json({ items: [post('p1')], nextCursor: null })
        }),
      )
      renderHome()

      expect(screen.getByRole('status', { name: 'Loading posts' })).toBeInTheDocument()
      release()
      expect(await within(main()).findByRole('article')).toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'Loading posts' })).not.toBeInTheDocument()
    })

    it('shows an error with Retry when the first load fails, and recovers', async () => {
      let calls = 0
      server.use(
        http.get(apiUrl('/feed'), () => {
          calls += 1
          return calls === 1
            ? HttpResponse.json({ message: 'Boom' }, { status: 500 })
            : HttpResponse.json({ items: [post('p1', { body: 'Back again' })], nextCursor: null })
        }),
      )
      const { user } = renderHome()

      expect(await screen.findByText(/Couldn't load your feed/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Retry' }))

      expect(await screen.findByText('Back again')).toBeInTheDocument()
      expect(screen.queryByText(/Couldn't load your feed/)).not.toBeInTheDocument()
      expect(calls).toBe(2)
    })

    it('loads the next page with "Load more" and then says it is all caught up', async () => {
      mockFeed([[post('p2', { body: 'Page one' })], [post('p1', { body: 'Page two' })]])
      const { user } = renderHome()

      expect(await screen.findByText('Page one')).toBeInTheDocument()
      expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Load more' }))

      expect(await screen.findByText('Page two')).toBeInTheDocument()
      expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    })

    // The deleted card (and the dialog's return-focus target) unmounts, so focus moves to a
    // neighbouring post instead of dropping to <body>.
    it.each([
      ['the next post', 'p2', 'p1'],
      ['the previous post when the last one is deleted', 'p1', 'p2'],
    ])('deletes a post after confirmation and focuses %s', async (_label, deletedId, focusedId) => {
      mockFeed([[post('p2', { body: 'Second thoughts' }), post('p1', { body: 'First light' })]])
      server.use(http.delete(apiUrl('/posts/:id'), () => new HttpResponse(null, { status: 204 })))
      const { user } = renderHome()

      const articles = await within(main()).findAllByRole('article')
      const deleted = articles.find((article) => article.dataset.postId === deletedId)
      await user.click(within(deleted).getByRole('button', { name: 'More options' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Delete post?' })
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(within(main()).getAllByRole('article')).toHaveLength(1))
      const remaining = within(main()).getByRole('article')
      expect(remaining.dataset.postId).toBe(focusedId)
      await waitFor(() =>
        expect(within(remaining).getByRole('link', { name: /Open post by @ada/ })).toHaveFocus(),
      )
    })
  })

  describe('composer focus', () => {
    it('focuses the composer when navigated here with state.focusComposer, then clears the state', async () => {
      renderHome({ pathname: '/', state: { focusComposer: true } })

      await waitFor(() => expect(composer()).toHaveFocus())
      await waitFor(() => expect(screen.getByTestId('location-state')).toHaveTextContent('null'))
      expect(composer()).toHaveAttribute('id', 'composer')
    })

    it("doesn't take focus on a normal visit", async () => {
      renderHome()

      await screen.findByRole('heading', { name: 'No posts yet' })
      expect(composer()).not.toHaveFocus()
      expect(document.body).toHaveFocus()
    })
  })
})
