import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Link, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { postKeys } from '@/lib/api/posts'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { FakeEventSource, installFakeEventSource } from '@/test/fake-event-source'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { Home } from '../Home'

const post = (id, overrides = {}) => ({
  id,
  body: `post ${id}`,
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'grace' },
  likeCount: 0,
  commentCount: 0,
  likedByMe: false,
  ...overrides,
})

// A feed endpoint serving `feed.pages` (mutable, so a test can add posts "on the server"):
// page i is `{ items: pages[i], nextCursor: 'c<i+1>' }`, the last with `nextCursor: null`.
// Records every request's cursor (null for the first page) in `feed.requests`.
function mockFeed(path, pages) {
  const feed = { pages, requests: [] }
  server.use(
    http.get(apiUrl(path), ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      feed.requests.push(cursor)
      const index = cursor ? Number(cursor.slice(1)) : 0
      return HttpResponse.json({
        items: feed.pages[index],
        nextCursor: index < feed.pages.length - 1 ? `c${index + 1}` : null,
      })
    }),
  )
  return feed
}

function Nav() {
  return (
    <nav>
      <Link to="/">Go home</Link>
      <Link to="/elsewhere">Go elsewhere</Link>
    </nav>
  )
}

// Home inside the real signed-in route (ProtectedRoute: realtime stream + new-posts tracker), plus
// another page to navigate to.
async function renderApp(route = '/') {
  const utils = renderWithProviders(
    <TooltipProvider>
      <Nav />
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home />} />
          <Route path="/elsewhere" element={<p>Elsewhere page</p>} />
        </Route>
      </Routes>
    </TooltipProvider>,
    { route },
  )
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
  FakeEventSource.latest.open()
  return utils
}

const stream = () => FakeEventSource.latest
const panel = () => screen.getByRole('tabpanel')
const pill = () => screen.queryByRole('button', { name: /^Show .* new posts?$/ })
const created = (id, following) => stream().emit('post.created', { id, following })

describe('Home new-posts pill', () => {
  let uninstall
  let following
  let forYou

  beforeEach(() => {
    uninstall = installFakeEventSource()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    following = mockFeed('/feed', [[post('p1', { body: 'Old following post' })]])
    forYou = mockFeed('/feed/for-you', [[post('p1', { body: 'Old for you post' })]])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    uninstall()
  })

  it('counts followed authors on Following and everyone on For you', async () => {
    const { user } = await renderApp()
    await within(panel()).findByText('Old following post')
    // Load For you too, so both feeds are cached before the posts arrive.
    await user.click(screen.getByRole('tab', { name: 'For you' }))
    await within(panel()).findByText('Old for you post')
    expect(pill()).not.toBeInTheDocument()

    created('p2', true)
    created('p3', false)

    expect(screen.getByRole('button', { name: 'Show 2 new posts' })).toHaveTextContent('2 new posts')

    await user.click(screen.getByRole('tab', { name: 'Following' }))
    expect(screen.getByRole('button', { name: 'Show 1 new post' })).toHaveTextContent('1 new post')
  })

  it('opens a row between the composer and the first post, and closes it when cleared', async () => {
    const { user } = await renderApp()
    const firstPost = await within(panel()).findByRole('article')
    const composer = screen.getByRole('textbox', { name: 'Compose a new post' })
    const header = screen.getByRole('heading', { level: 1, name: 'Home' }).closest('.sticky')
    const row = screen.getByTestId('new-posts-row')
    const pillWrapper = screen.getByTestId('new-posts-pill')
    const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

    // Collapsed: the row has no height and the pill is mounted but unreachable.
    expect(panel()).toContainElement(row)
    expect(header).not.toContainElement(pillWrapper)
    expect(follows(composer, row)).toBe(true)
    expect(follows(row, firstPost)).toBe(true)
    expect(row).toHaveClass('grid-rows-[0fr]')
    expect(pillWrapper).toHaveAttribute('inert')
    expect(pillWrapper).toHaveAttribute('aria-hidden', 'true')
    expect(within(pillWrapper).getByRole('button', { hidden: true })).toHaveAttribute('tabindex', '-1')
    expect(pill()).not.toBeInTheDocument()

    created('p2', true)

    // Open: the row takes its height and the button is exposed, in the row's slot.
    expect(row).toHaveClass('grid-rows-[1fr]')
    expect(pillWrapper).not.toHaveAttribute('inert')
    expect(pillWrapper).not.toHaveAttribute('aria-hidden')
    const button = screen.getByRole('button', { name: 'Show 1 new post' })
    expect(pillWrapper).toContainElement(button)
    expect(button).not.toHaveAttribute('tabindex')
    expect(follows(composer, button)).toBe(true)
    expect(follows(button, firstPost)).toBe(true)
    // The pill is a zero-height sticky overlay, a sibling of the row (not inside it), so it can
    // dock under the header when scrolled.
    expect(pillWrapper.parentElement).toHaveClass('sticky', 'h-0')
    expect(row).not.toContainElement(pillWrapper)

    // More posts only change the label.
    created('p3', true)
    expect(screen.getByRole('button', { name: 'Show 2 new posts' })).toBeInTheDocument()
    expect(row).toHaveClass('grid-rows-[1fr]')

    // Cleared: collapses, keeping the last label for the fade-out, unreachable again.
    await user.click(screen.getByRole('button', { name: 'Show 2 new posts' }))
    expect(row).toHaveClass('grid-rows-[0fr]')
    expect(pillWrapper).toHaveAttribute('inert')
    expect(within(pillWrapper).getByRole('button', { hidden: true })).toHaveTextContent('2 new posts')
    expect(pill()).not.toBeInTheDocument()
  })

  it('turns the row and pill transitions off for reduced motion', async () => {
    await renderApp()
    await within(panel()).findByRole('article')

    expect(screen.getByTestId('new-posts-row')).toHaveClass('motion-reduce:transition-none')
    expect(screen.getByTestId('new-posts-pill')).toHaveClass('motion-reduce:transition-none')
  })

  it('ignores a post it already counts', async () => {
    await renderApp()
    await within(panel()).findByText('Old following post')

    created('p2', true)
    created('p2', true)

    expect(screen.getByRole('button', { name: 'Show 1 new post' })).toBeInTheDocument()
  })

  it('shows 99+ past 99 posts', async () => {
    await renderApp()
    await within(panel()).findByText('Old following post')

    for (let i = 0; i < 100; i += 1) created(`n${i}`, true)

    expect(screen.getByRole('button', { name: 'Show 99+ new posts' })).toHaveTextContent('99+ new posts')
  })

  it('counts down when a pending post is deleted, and ignores other deletions', async () => {
    await renderApp()
    await within(panel()).findByText('Old following post')
    created('p2', true)
    created('p3', true)

    stream().emit('post.deleted', { id: 'p2' })
    expect(screen.getByRole('button', { name: 'Show 1 new post' })).toBeInTheDocument()

    stream().emit('post.deleted', { id: 'unrelated' })
    expect(screen.getByRole('button', { name: 'Show 1 new post' })).toBeInTheDocument()

    stream().emit('post.deleted', { id: 'p3' })
    expect(pill()).not.toBeInTheDocument()
  })

  it('never moves the list on its own when posts arrive', async () => {
    await renderApp()
    await within(panel()).findByText('Old following post')
    const requestsBefore = following.requests.length

    following.pages[0] = [post('p2', { body: 'Fresh post' }), ...following.pages[0]]
    created('p2', true)

    expect(pill()).toBeInTheDocument()
    expect(within(panel()).getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByText('Fresh post')).not.toBeInTheDocument()
    expect(following.requests).toHaveLength(requestsBefore)
  })

  it('loads the first page again on click, with the new posts on top, and clears the pill', async () => {
    following.pages = [[post('p2', { body: 'Page one' })], [post('p1', { body: 'Page two' })]]
    const { user } = await renderApp()
    await within(panel()).findByText('Page one')
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await within(panel()).findByText('Page two')
    expect(following.requests).toEqual([null, 'c1'])

    following.pages[0] = [post('p3', { body: 'Brand new post' }), ...following.pages[0]]
    created('p3', true)
    await user.click(screen.getByRole('button', { name: 'Show 1 new post' }))

    expect(pill()).not.toBeInTheDocument()
    await within(panel()).findByText('Brand new post')
    const articles = within(panel()).getAllByRole('article')
    expect(articles[0]).toHaveTextContent('Brand new post')
    // Only the first page was requested again; the old later page is gone until "load more".
    expect(following.requests).toEqual([null, 'c1', null])
    expect(screen.queryByText('Page two')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 })
    expect(panel()).toHaveFocus()
  })

  it('refreshes only the selected tab and keeps the other tab pending', async () => {
    const { user } = await renderApp()
    await within(panel()).findByText('Old following post')
    await user.click(screen.getByRole('tab', { name: 'For you' }))
    await within(panel()).findByText('Old for you post')
    created('p2', true)

    forYou.pages[0] = [post('p2', { body: 'New for you' }), ...forYou.pages[0]]
    await user.click(screen.getByRole('button', { name: 'Show 1 new post' }))
    await within(panel()).findByText('New for you')
    expect(pill()).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Following' }))
    expect(screen.getByRole('button', { name: 'Show 1 new post' })).toBeInTheDocument()
  })

  it('keeps the count while away from Home', async () => {
    const { user } = await renderApp()
    await within(panel()).findByText('Old following post')
    created('p2', true)

    await user.click(screen.getByRole('link', { name: 'Go elsewhere' }))
    expect(await screen.findByText('Elsewhere page')).toBeInTheDocument()
    created('p3', true)

    await user.click(screen.getByRole('link', { name: 'Go home' }))
    await within(panel()).findByText('Old following post')
    expect(screen.getByRole('button', { name: 'Show 2 new posts' })).toBeInTheDocument()
  })

  it('clears the pill when the feed is loaded from the first page for another reason', async () => {
    const { queryClient } = await renderApp()
    await within(panel()).findByText('Old following post')
    created('p2', true)
    expect(pill()).toBeInTheDocument()

    following.pages[0] = [post('p2', { body: 'Refetched post' }), ...following.pages[0]]
    await queryClient.refetchQueries({ queryKey: postKeys.feed() })

    await waitFor(() => expect(pill()).not.toBeInTheDocument())
    expect(screen.getByText('Refetched post')).toBeInTheDocument()
  })

  it('keeps a post that arrives while a refetch is in flight', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const { queryClient } = await renderApp()
    await within(panel()).findByText('Old following post')
    server.use(
      http.get(apiUrl('/feed'), async () => {
        await gate
        return HttpResponse.json({ items: [post('p1', { body: 'Old following post' })], nextCursor: null })
      }),
    )

    const refetch = queryClient.refetchQueries({ queryKey: postKeys.feed() })
    created('p2', true)
    release()
    await refetch

    expect(screen.getByRole('button', { name: 'Show 1 new post' })).toBeInTheDocument()
  })

  it('announces the latest count once in a polite live region', async () => {
    await renderApp()
    await within(panel()).findByText('Old following post')
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')

    created('p2', true)
    created('p3', true)
    created('p4', true)
    expect(region).toHaveTextContent('')

    await waitFor(() => expect(region).toHaveTextContent('3 new posts available'), { timeout: 2000 })
  })
})
