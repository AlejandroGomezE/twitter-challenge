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
  ada: { username: 'ada', bio: 'Math & engines', createdAt: CREATED_AT, postCount: 0 },
  grace: { username: 'grace', bio: null, createdAt: CREATED_AT, postCount: 0 },
}

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
// Also serves `GET /users/:username/posts`: `posts[username]` is a list of pages (page i →
// `nextCursor: 'c<i+1>'`, the last `null`), default one empty page; unknown users → 404;
// `state.postsStatus` forces an error status for the next posts requests.
function mockProfiles(profiles = PROFILES, posts = {}) {
  const state = { status: 200, postsStatus: 200, requests: [] }
  server.use(
    http.get(apiUrl('/users/:username/posts'), ({ params, request }) => {
      if (state.postsStatus !== 200) {
        return HttpResponse.json({ message: 'Server error' }, { status: state.postsStatus })
      }
      const key = params.username.toLowerCase()
      if (!profiles[key]) return HttpResponse.json({ message: 'User not found' }, { status: 404 })
      const pages = posts[key] ?? [[]]
      const cursor = new URL(request.url).searchParams.get('cursor')
      const index = cursor ? Number(cursor.slice(1)) : 0
      return HttpResponse.json({
        items: pages[index],
        nextCursor: index < pages.length - 1 ? `c${index + 1}` : null,
      })
    }),
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
    // Was "No posts yet" before posts existed; your own empty profile now says so in your words.
    expect(await page.findByRole('heading', { name: "You haven't posted yet" })).toBeInTheDocument()
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
  describe('posts tab', () => {
    it("lists the user's posts as served (newest first) with the post count in the header", async () => {
      mockProfiles(
        { ...PROFILES, ada: { ...PROFILES.ada, postCount: 2 } },
        { ada: [[post('p2', { body: 'Newer thoughts' }), post('p1', { body: 'Older thoughts' })]] },
      )

      renderApp('/u/ada')

      const panel = await screen.findByRole('tabpanel', { name: 'Posts' })
      const articles = await within(panel).findAllByRole('article')
      expect(articles).toHaveLength(2)
      expect(articles[0]).toHaveTextContent('Newer thoughts')
      expect(articles[1]).toHaveTextContent('Older thoughts')
      expect(within(screen.getByRole('main')).getByText('2 posts')).toBeInTheDocument()
      expect(within(panel).getByText("That's all of @ada's posts")).toBeInTheDocument()
      expect(within(panel).queryByRole('heading', { name: "You haven't posted yet" })).not.toBeInTheDocument()
    })

    it("says '1 post' (singular) and '@grace hasn't posted yet' on someone else's empty profile", async () => {
      mockProfiles({ ...PROFILES, grace: { ...PROFILES.grace, postCount: 1 } })

      renderApp('/u/grace')

      expect(await screen.findByRole('heading', { name: "@grace hasn't posted yet" })).toBeInTheDocument()
      expect(screen.getByText('1 post')).toBeInTheDocument()
      expect(screen.queryByText("You haven't posted yet")).not.toBeInTheDocument()
    })

    it('shows no post count until the profile carries one', async () => {
      mockProfiles({ ...PROFILES, ada: { ...PROFILES.ada, postCount: undefined } })

      renderApp('/u/ada')

      expect(await screen.findByRole('heading', { name: "You haven't posted yet" })).toBeInTheDocument()
      expect(within(screen.getByRole('main')).queryByText(/\d+ posts?$/)).not.toBeInTheDocument()
    })

    it('shows skeletons while the posts load', async () => {
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      mockProfiles()
      server.use(
        http.get(apiUrl('/users/:username/posts'), async () => {
          await gate
          return HttpResponse.json({ items: [post('p1', { body: 'Arrived' })], nextCursor: null })
        }),
      )

      renderApp('/u/ada')

      expect(await screen.findByRole('status', { name: 'Loading posts' })).toBeInTheDocument()
      release()
      expect(await screen.findByText('Arrived')).toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'Loading posts' })).not.toBeInTheDocument()
    })

    it('shows an error with Retry when the posts fail to load, and recovers', async () => {
      const profiles = mockProfiles(PROFILES, { ada: [[post('p1', { body: 'Back again' })]] })
      profiles.postsStatus = 500

      const { user } = renderApp('/u/ada')

      expect(await screen.findByText(/Couldn't load posts/)).toBeInTheDocument()
      // The profile itself still rendered.
      expect(screen.getByRole('heading', { name: '@ada' })).toBeInTheDocument()

      profiles.postsStatus = 200
      await user.click(screen.getByRole('button', { name: 'Retry' }))

      expect(await screen.findByText('Back again')).toBeInTheDocument()
      expect(screen.queryByText(/Couldn't load posts/)).not.toBeInTheDocument()
    })

    it('loads the next page with "Load more"', async () => {
      mockProfiles(PROFILES, {
        ada: [[post('p2', { body: 'Page one' })], [post('p1', { body: 'Page two' })]],
      })

      const { user } = renderApp('/u/ada')

      expect(await screen.findByText('Page one')).toBeInTheDocument()
      expect(screen.queryByText("That's all of @ada's posts")).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Load more' }))

      expect(await screen.findByText('Page two')).toBeInTheDocument()
      expect(await screen.findByText("That's all of @ada's posts")).toBeInTheDocument()
    })
  })
})
