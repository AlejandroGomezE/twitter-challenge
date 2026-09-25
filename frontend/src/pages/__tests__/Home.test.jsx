import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { Home } from '../Home'

// Shows the router's current `location.search` and `location.state`, to check Home updates them.
function LocationState() {
  const location = useLocation()
  return (
    <>
      <output data-testid="location-search">{location.search}</output>
      <output data-testid="location-state">{JSON.stringify(location.state)}</output>
    </>
  )
}

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

// `GET /feed` (or `path`) serving `pages` in order: page i is `{ items: pages[i], nextCursor: 'c<i+1>' }`, the
// last with `nextCursor: null`. The cursor picks the page.
function mockFeed(pages, path = '/feed') {
  server.use(
    http.get(apiUrl(path), ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      const index = cursor ? Number(cursor.slice(1)) : 0
      return HttpResponse.json({
        items: pages[index],
        nextCursor: index < pages.length - 1 ? `c${index + 1}` : null,
      })
    }),
  )
}

const main = () => screen.getByRole('tabpanel', { name: 'Following' })
const composer = () => screen.getByRole('textbox', { name: 'Compose a new post' })

describe('Home', () => {
  it('shows the "Home" header with the Following tab selected by default', () => {
    renderHome()

    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(screen.getByText('created by Alejandro Gomez')).toBeInTheDocument()

    const tablist = screen.getByRole('tablist', { name: 'Feed' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Following', 'For you'])
    const [following, forYou] = tabs
    expect(following).toHaveAttribute('aria-selected', 'true')
    expect(following).toHaveAttribute('tabindex', '0')
    expect(forYou).toHaveAttribute('aria-selected', 'false')
    expect(forYou).toHaveAttribute('tabindex', '-1')
    expect(following).not.toHaveAttribute('aria-disabled')

    const panel = screen.getByRole('tabpanel', { name: 'Following' })
    expect(following).toHaveAttribute('aria-controls', panel.id)
    expect(forYou).toHaveAttribute('aria-controls', panel.id)
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

  it('shows the Following empty state, whose button switches to For you', async () => {
    const { user } = renderHome()

    expect(await screen.findByRole('heading', { name: 'Your Following feed is empty' })).toBeInTheDocument()
    expect(screen.getByText('Follow people to see their posts here.')).toBeInTheDocument()
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Explore For you' }))

    expect(screen.getByRole('tab', { name: 'For you' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=for-you')
    expect(await screen.findByRole('heading', { name: 'No posts yet' })).toBeInTheDocument()
  })

  describe('tabs', () => {
    // Serves one post from each feed endpoint and counts the requests to each.
    function countFeedRequests() {
      const calls = { following: 0, forYou: 0 }
      server.use(
        http.get(apiUrl('/feed'), () => {
          calls.following += 1
          return HttpResponse.json({ items: [post('f1', { body: 'Following post' })], nextCursor: null })
        }),
        http.get(apiUrl('/feed/for-you'), () => {
          calls.forYou += 1
          return HttpResponse.json({ items: [post('y1', { body: 'For you post' })], nextCursor: null })
        }),
      )
      return calls
    }

    it('loads GET /feed for the default Following tab', async () => {
      const calls = countFeedRequests()
      renderHome()

      expect(await within(main()).findByText('Following post')).toBeInTheDocument()
      expect(calls).toEqual({ following: 1, forYou: 0 })
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()
    })

    it('switches to For you: loads GET /feed/for-you and sets ?tab=for-you', async () => {
      const calls = countFeedRequests()
      const { user } = renderHome()
      await screen.findByText('Following post')

      await user.click(screen.getByRole('tab', { name: 'For you' }))

      const panel = screen.getByRole('tabpanel', { name: 'For you' })
      expect(await within(panel).findByText('For you post')).toBeInTheDocument()
      expect(screen.queryByText('Following post')).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'For you' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=for-you')
      expect(calls.forYou).toBe(1)

      // And back: the param is removed.
      await user.click(screen.getByRole('tab', { name: 'Following' }))
      expect(await screen.findByText('Following post')).toBeInTheDocument()
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement()
    })

    it('keeps the other search params when switching', async () => {
      countFeedRequests()
      const { user } = renderHome('/?ref=nav')

      await user.click(screen.getByRole('tab', { name: 'For you' }))

      const search = new URLSearchParams(screen.getByTestId('location-search').textContent)
      expect(search.get('ref')).toBe('nav')
      expect(search.get('tab')).toBe('for-you')
    })

    it('selects For you when loaded with ?tab=for-you', async () => {
      const calls = countFeedRequests()
      renderHome('/?tab=for-you')

      expect(screen.getByRole('tab', { name: 'For you' })).toHaveAttribute('aria-selected', 'true')
      const panel = screen.getByRole('tabpanel', { name: 'For you' })
      expect(await within(panel).findByText('For you post')).toBeInTheDocument()
      expect(calls).toEqual({ following: 0, forYou: 1 })
    })

    it('falls back to Following for an unknown tab value', async () => {
      countFeedRequests()
      renderHome('/?tab=nope')

      expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'true')
      expect(await within(main()).findByText('Following post')).toBeInTheDocument()
    })

    it('shows the plain "No posts yet" empty state on For you', async () => {
      renderHome('/?tab=for-you')

      expect(await screen.findByRole('heading', { name: 'No posts yet' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Explore For you' })).not.toBeInTheDocument()
    })

    it('moves focus between tabs with the arrow keys and activates with Enter', async () => {
      const calls = countFeedRequests()
      const { user } = renderHome()
      const following = screen.getByRole('tab', { name: 'Following' })
      const forYou = screen.getByRole('tab', { name: 'For you' })

      following.focus()
      await user.keyboard('{ArrowRight}')
      expect(forYou).toHaveFocus()
      expect(forYou).toHaveAttribute('tabindex', '0')
      expect(following).toHaveAttribute('tabindex', '-1')
      // Manual activation: moving focus alone doesn't switch the tab.
      expect(following).toHaveAttribute('aria-selected', 'true')

      await user.keyboard('{ArrowRight}')
      expect(following).toHaveFocus()
      await user.keyboard('{ArrowLeft}')
      expect(forYou).toHaveFocus()

      await user.keyboard('{Enter}')
      expect(forYou).toHaveAttribute('aria-selected', 'true')
      expect(forYou).toHaveFocus()
      expect(await screen.findByText('For you post')).toBeInTheDocument()
      expect(calls.forYou).toBe(1)
    })

    it('shows a For you specific error with Retry when that feed fails', async () => {
      server.use(http.get(apiUrl('/feed/for-you'), () => HttpResponse.json({ message: 'Boom' }, { status: 500 })))
      renderHome('/?tab=for-you')

      expect(await screen.findByText(/Couldn't load the For you feed/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('keeps the tab when focusing the composer from a navigation', async () => {
      renderHome({ pathname: '/', search: '?tab=for-you', state: { focusComposer: true } })

      await waitFor(() => expect(composer()).toHaveFocus())
      await waitFor(() => expect(screen.getByTestId('location-state')).toHaveTextContent('null'))
      expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=for-you')
      expect(screen.getByRole('tab', { name: 'For you' })).toHaveAttribute('aria-selected', 'true')
    })
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
      expect(screen.queryByRole('heading', { name: 'Your Following feed is empty' })).not.toBeInTheDocument()
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

      expect(await screen.findByText(/Couldn't load your Following feed/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Retry' }))

      expect(await screen.findByText('Back again')).toBeInTheDocument()
      expect(screen.queryByText(/Couldn't load your Following feed/)).not.toBeInTheDocument()
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

      await screen.findByRole('heading', { name: 'Your Following feed is empty' })
      expect(composer()).not.toHaveFocus()
      expect(document.body).toHaveFocus()
    })
  })
})
