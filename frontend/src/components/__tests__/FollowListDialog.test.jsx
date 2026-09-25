import { focusManager } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { act, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { FollowListDialog } from '@/components/FollowListDialog'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

const followUser = (username, overrides = {}) => ({
  username,
  bio: `bio of ${username}`,
  isFollowing: false,
  followsYou: false,
  ...overrides,
})

// Serves `GET /users/:username/{following,followers}` from `lists[kind]`: a list of pages (page i →
// `nextCursor: 'c<i+1>'`, the last `null`). `state.requests` records `kind cursor|-`;
// `state.status[kind]` forces an error status for that list; `state.hold` (a promise) holds the
// responses until it resolves. `lists` is read at request time, so tests can change it.
function mockFollowLists(lists) {
  const state = { requests: [], status: {}, hold: null }
  for (const kind of ['following', 'followers']) {
    server.use(
      http.get(apiUrl(`/users/:username/${kind}`), async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        state.requests.push(`${kind} ${cursor ?? '-'}`)
        if (state.hold) await state.hold
        if (state.status[kind]) {
          return HttpResponse.json({ message: 'Server error' }, { status: state.status[kind] })
        }
        const pages = lists[kind] ?? [[]]
        const index = cursor ? Number(cursor.slice(1)) : 0
        return HttpResponse.json({
          items: pages[index],
          nextCursor: index < pages.length - 1 ? `c${index + 1}` : null,
        })
      }),
    )
  }
  return state
}

function LocationDisplay() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

// Owns the dialog's state like Profile does, with an opener button per tab.
function Harness({ username = 'grace', initialTab = null, isOwnProfile = false }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <>
      <button type="button" onClick={() => setTab('following')}>
        open following
      </button>
      <button type="button" onClick={() => setTab('followers')}>
        open followers
      </button>
      <FollowListDialog
        username={username}
        tab={tab}
        onTabChange={setTab}
        onClose={() => setTab(null)}
        isOwnProfile={isOwnProfile}
      />
      <LocationDisplay />
    </>
  )
}

describe('FollowListDialog', () => {
  it('opens on the clicked tab, titled with @username, fetching only that list', async () => {
    const state = mockFollowLists({ followers: [[followUser('linus')]] })
    const { user } = renderWithProviders(<Harness />)

    await user.click(screen.getByRole('button', { name: 'open followers' }))

    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    expect(within(dialog).getByRole('tab', { name: 'Followers' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(dialog).getByRole('tab', { name: 'Following' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(await within(dialog).findByRole('link', { name: '@linus' })).toBeInTheDocument()
    expect(state.requests).toEqual(['followers -'])
  })

  it("shows a row's display name before its @username", async () => {
    mockFollowLists({
      followers: [[followUser('linus', { displayName: 'Linus Torvalds' }), followUser('margaret')]],
    })
    const { user } = renderWithProviders(<Harness />)

    await user.click(screen.getByRole('button', { name: 'open followers' }))

    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    const linus = await within(dialog).findByRole('link', { name: 'Linus Torvalds @linus' })
    expect(linus).toHaveAttribute('href', '/u/linus')
    expect(within(linus).getByText('@linus')).toHaveClass('text-muted-foreground')
    expect(within(dialog).getByRole('link', { name: '@margaret' })).toBeInTheDocument()
  })

  it('fetches nothing while closed', async () => {
    const state = mockFollowLists({})
    renderWithProviders(<Harness />)

    // Give any stray fetch a chance to start.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(state.requests).toEqual([])
  })

  it('switches tabs and fetches the other list only then', async () => {
    const state = mockFollowLists({
      following: [[followUser('linus')]],
      followers: [[followUser('margaret')]],
    })
    const { user } = renderWithProviders(<Harness initialTab="following" />)

    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    expect(await within(dialog).findByRole('link', { name: '@linus' })).toBeInTheDocument()
    expect(state.requests).toEqual(['following -'])

    await user.click(within(dialog).getByRole('tab', { name: 'Followers' }))

    expect(await within(dialog).findByRole('link', { name: '@margaret' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: '@linus' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { name: 'Followers' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(state.requests).toEqual(['following -', 'followers -'])
  })

  describe('freshness', () => {
    // Holds the list responses until the returned `release()` is called.
    function holdResponses(state) {
      let release
      state.hold = new Promise((resolve) => {
        release = resolve
      })
      return () => {
        state.hold = null
        release()
      }
    }

    it('refetches the list on reopen, showing the cached rows meanwhile', async () => {
      const lists = { following: [[followUser('linus')]] }
      const state = mockFollowLists(lists)
      const { user } = renderWithProviders(<Harness />)

      await user.click(screen.getByRole('button', { name: 'open following' }))
      let dialog = await screen.findByRole('dialog', { name: '@grace' })
      expect(await within(dialog).findByRole('link', { name: '@linus' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      lists.following = [[followUser('margaret'), followUser('linus')]]
      const release = holdResponses(state)
      await user.click(screen.getByRole('button', { name: 'open following' }))
      dialog = await screen.findByRole('dialog', { name: '@grace' })

      await waitFor(() => expect(state.requests).toEqual(['following -', 'following -']))
      // Cached rows, no skeleton, while the refetch is in flight.
      expect(within(dialog).getByRole('link', { name: '@linus' })).toBeInTheDocument()
      expect(within(dialog).queryByRole('status', { name: 'Loading users' })).not.toBeInTheDocument()

      release()
      expect(await within(dialog).findByRole('link', { name: '@margaret' })).toBeInTheDocument()
    })

    it('refetches a tab when switching back to it, showing the cached rows meanwhile', async () => {
      const lists = { following: [[followUser('linus')]], followers: [[followUser('barbara')]] }
      const state = mockFollowLists(lists)
      const { user } = renderWithProviders(<Harness initialTab="following" />)

      const dialog = await screen.findByRole('dialog', { name: '@grace' })
      expect(await within(dialog).findByRole('link', { name: '@linus' })).toBeInTheDocument()
      await user.click(within(dialog).getByRole('tab', { name: 'Followers' }))
      expect(await within(dialog).findByRole('link', { name: '@barbara' })).toBeInTheDocument()

      lists.following = [[followUser('margaret'), followUser('linus')]]
      const release = holdResponses(state)
      await user.click(within(dialog).getByRole('tab', { name: 'Following' }))

      await waitFor(() =>
        expect(state.requests).toEqual(['following -', 'followers -', 'following -']),
      )
      expect(within(dialog).getByRole('link', { name: '@linus' })).toBeInTheDocument()
      expect(within(dialog).queryByRole('status', { name: 'Loading users' })).not.toBeInTheDocument()

      release()
      expect(await within(dialog).findByRole('link', { name: '@margaret' })).toBeInTheDocument()
    })

    it('keeps an unfollowed row (showing Follow) without refetching while the list stays open', async () => {
      const lists = { following: [[followUser('linus', { isFollowing: true })]] }
      const state = mockFollowLists(lists)
      const { user } = renderWithProviders(<Harness initialTab="following" />)

      const dialog = await screen.findByRole('dialog', { name: '@grace' })
      await user.click(await within(dialog).findByRole('button', { name: 'Unfollow @linus' }))
      lists.following = [[]]

      expect(await within(dialog).findByRole('button', { name: 'Follow @linus' })).toBeInTheDocument()
      // Give a stray refetch a chance to land.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(within(dialog).getByRole('link', { name: '@linus' })).toBeInTheDocument()
      expect(state.requests).toEqual(['following -'])
    })

    it('does not refetch an open list on window focus, keeping an unfollowed row', async () => {
      const lists = { following: [[followUser('linus', { isFollowing: true })]] }
      const state = mockFollowLists(lists)
      const { user } = renderWithProviders(<Harness initialTab="following" />)

      const dialog = await screen.findByRole('dialog', { name: '@grace' })
      await user.click(await within(dialog).findByRole('button', { name: 'Unfollow @linus' }))
      expect(await within(dialog).findByRole('button', { name: 'Follow @linus' })).toBeInTheDocument()
      lists.following = [[]]

      try {
        act(() => {
          focusManager.setFocused(false)
          focusManager.setFocused(true)
        })
        await new Promise((resolve) => setTimeout(resolve, 50))
      } finally {
        focusManager.setFocused(undefined)
      }
      expect(state.requests).toEqual(['following -'])
      expect(within(dialog).getByRole('button', { name: 'Follow @linus' })).toBeInTheDocument()
    })
  })

  it('shows avatar, @username and bio per row; the row links to the profile and closes the dialog', async () => {
    mockFollowLists({ following: [[followUser('linus', { bio: 'Kernels' })]] })
    const { user } = renderWithProviders(<Harness initialTab="following" />)

    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    const link = await within(dialog).findByRole('link', { name: '@linus' })
    expect(link).toHaveAttribute('href', '/u/linus')
    const row = link.closest('li')
    expect(within(row).getByRole('img', { name: '@linus' })).toBeInTheDocument()
    expect(within(row).getByText('Kernels')).toHaveClass('line-clamp-2')

    await user.click(link)

    expect(screen.getByTestId('location')).toHaveTextContent('/u/linus')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows Follow / Follow back / Following buttons, none on your own row', async () => {
    mockFollowLists({
      followers: [
        [
          followUser('linus'),
          followUser('margaret', { followsYou: true }),
          followUser('barbara', { isFollowing: true, followsYou: true }),
          followUser('Ada'),
        ],
      ],
    })
    const { user } = renderWithProviders(<Harness initialTab="followers" />)

    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    await within(dialog).findByRole('link', { name: '@linus' })

    expect(within(dialog).getByRole('button', { name: 'Follow @linus' })).toHaveTextContent(
      /^Follow$/,
    )
    expect(
      within(dialog).getByRole('button', { name: 'Follow back @margaret' }),
    ).toHaveTextContent(/^Follow back$/)
    expect(within(dialog).getByRole('button', { name: 'Unfollow @barbara' })).toHaveTextContent(
      /^Following$/,
    )
    // The signed-in user (ada, compared case-insensitively) gets no button.
    const ownRow = within(dialog).getByRole('link', { name: '@Ada' }).closest('li')
    expect(within(ownRow).queryByRole('button')).not.toBeInTheDocument()

    // Following from a row flips it (optimistic) without navigating or closing the dialog.
    await user.click(within(dialog).getByRole('button', { name: 'Follow @linus' }))
    expect(
      await within(dialog).findByRole('button', { name: 'Unfollow @linus' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    expect(screen.getByRole('dialog', { name: '@grace' })).toBeInTheDocument()

    // Unfollowing is one click too.
    await user.click(within(dialog).getByRole('button', { name: 'Unfollow @barbara' }))
    expect(
      await within(dialog).findByRole('button', { name: 'Follow back @barbara' }),
    ).toBeInTheDocument()
  })

  it('loads page 2 with "Load more"', async () => {
    const state = mockFollowLists({
      following: [[followUser('linus')], [followUser('margaret')]],
    })
    const { user } = renderWithProviders(<Harness initialTab="following" />)

    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    await within(dialog).findByRole('link', { name: '@linus' })
    expect(within(dialog).queryByRole('link', { name: '@margaret' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Load more' }))

    expect(await within(dialog).findByRole('link', { name: '@margaret' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: '@linus' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(state.requests).toEqual(['following -', 'following c1'])
  })

  it("shows empty states worded for someone else's lists", async () => {
    mockFollowLists({})
    const { user } = renderWithProviders(<Harness initialTab="following" />)

    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    expect(
      await within(dialog).findByText("@grace isn't following anyone yet"),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('tab', { name: 'Followers' }))
    expect(
      await within(dialog).findByText("@grace doesn't have any followers yet"),
    ).toBeInTheDocument()
  })

  it('shows empty states worded for your own lists', async () => {
    mockFollowLists({})
    const { user } = renderWithProviders(
      <Harness username="ada" initialTab="following" isOwnProfile />,
    )

    const dialog = await screen.findByRole('dialog', { name: '@ada' })
    expect(await within(dialog).findByText("You aren't following anyone yet")).toBeInTheDocument()

    await user.click(within(dialog).getByRole('tab', { name: 'Followers' }))
    expect(await within(dialog).findByText("You don't have any followers yet")).toBeInTheDocument()
  })

  it('shows skeletons while loading, then an error with Retry that recovers', async () => {
    const state = mockFollowLists({ followers: [[followUser('linus')]] })
    state.status.followers = 500
    const { user } = renderWithProviders(<Harness initialTab="followers" />)

    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    expect(within(dialog).getByRole('status', { name: 'Loading users' })).toBeInTheDocument()

    expect(
      await within(dialog).findByText(/Couldn't load this user's followers/),
    ).toBeInTheDocument()

    delete state.status.followers
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))

    expect(await within(dialog).findByRole('link', { name: '@linus' })).toBeInTheDocument()
    expect(within(dialog).queryByText(/Couldn't load/)).not.toBeInTheDocument()
  })

  it('closes with the close button and returns focus to the opener', async () => {
    mockFollowLists({})
    const { user } = renderWithProviders(<Harness />)
    const opener = screen.getByRole('button', { name: 'open following' })

    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: '@grace' })
    expect(within(dialog).getByRole('tablist')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
