import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import type { Notification, NotificationType } from '@/lib/api/types'
import { FakeEventSource, installFakeEventSource } from '@/test/fake-event-source'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const notification = (
  id: string,
  type: NotificationType,
  overrides: Partial<Notification> = {},
): Notification => ({
  id,
  type,
  createdAt: minutesAgo(Number(id.slice(1))),
  read: false,
  actor: { username: 'bob', displayName: 'Bob Builder' },
  post: type === 'follow' ? null : { id: 'p1', body: 'My first post' },
  comment: type === 'comment' ? { id: 'c1', body: 'Nice one!' } : null,
  ...overrides,
})

// Serves `GET /notifications` (page i → `nextCursor: 'c<i+1>'`, the last `null`) and records the
// `POST /notifications/read` bodies. `state.status` forces an error status for the list.
function mockNotifications(pages: Notification[][] = [[]]) {
  const state: { status: number; listRequests: number; readBodies: unknown[] } = {
    status: 200,
    listRequests: 0,
    readBodies: [],
  }
  server.use(
    http.get(apiUrl('/notifications'), ({ request }) => {
      state.listRequests += 1
      if (state.status !== 200) {
        return HttpResponse.json({ message: 'Server error' }, { status: state.status })
      }
      const cursor = new URL(request.url).searchParams.get('cursor')
      const index = cursor ? Number(cursor.slice(1)) : 0
      return HttpResponse.json({
        items: pages[index],
        nextCursor: index + 1 < pages.length ? `c${index + 1}` : null,
      })
    }),
    http.post(apiUrl('/notifications/read'), async ({ request }) => {
      state.readBodies.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return state
}

async function renderNotifications() {
  const utils = renderWithProviders(<AppRouter />, { route: '/notifications' })
  await screen.findByRole('main')
  return utils
}

const main = () => within(screen.getByRole('main'))

describe('Notifications', () => {
  beforeEach(() => {
    // The nav badge (if any) polls the unread count; keep it answered for these tests.
    server.use(http.get(apiUrl('/notifications/unread-count'), () => HttpResponse.json({ count: 0 })))
  })

  it('lists notifications newest first with actor, text, snippet links and time', async () => {
    mockNotifications([
      [
        notification('n1', 'comment'),
        notification('n2', 'like', { actor: { username: 'carol', displayName: null } }),
        notification('n3', 'follow', { read: true }),
      ],
    ])
    await renderNotifications()

    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
    const list = await main().findByRole('list', { name: 'Notifications' })
    const rows = within(list).getAllByRole('article')
    expect(rows).toHaveLength(3)

    expect(rows[0]).toHaveAccessibleName('Bob Builder commented on your post')
    expect(within(rows[0]).getByRole('link', { name: 'Bob Builder @bob' })).toHaveAttribute(
      'href',
      '/u/bob',
    )
    expect(
      within(rows[0]).getByRole('link', { name: 'View comment on your post: Nice one!' }),
    ).toHaveAttribute('href', '/u/ada/posts/p1')
    expect(within(rows[0]).getByText('1m')).toBeInTheDocument()

    expect(rows[1]).toHaveAccessibleName('@carol liked your post')
    expect(within(rows[1]).getByRole('link', { name: '@carol' })).toHaveAttribute('href', '/u/carol')
    expect(
      within(rows[1]).getByRole('link', { name: 'View your post: My first post' }),
    ).toHaveAttribute('href', '/u/ada/posts/p1')

    expect(rows[2]).toHaveAccessibleName('Bob Builder followed you')
    expect(within(rows[2]).getAllByRole('link')).toHaveLength(1)

    // Unread rows are highlighted (and announced); read ones aren't.
    expect(rows[0]).toHaveAttribute('data-unread', 'true')
    expect(rows[1]).toHaveAttribute('data-unread', 'true')
    expect(rows[2]).not.toHaveAttribute('data-unread')
    expect(within(rows[0]).getByText('(unread)')).toBeInTheDocument()
    expect(main().getByText("You're all caught up")).toBeInTheDocument()
  })

  it('marks everything up to the newest item as read once, keeping the highlight', async () => {
    const pages = [[notification('n1', 'like'), notification('n2', 'follow')], [notification('n3', 'follow')]]
    const state = mockNotifications(pages)
    const { user } = await renderNotifications()

    await waitFor(() => expect(state.readBodies).toEqual([{ until: pages[0][0].createdAt }]))
    const list = main().getByRole('list', { name: 'Notifications' })
    expect(within(list).getAllByRole('article')[0]).toHaveAttribute('data-unread', 'true')

    await user.click(main().getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(within(list).getAllByRole('article')).toHaveLength(3))

    expect(state.readBodies).toHaveLength(1)
    expect(within(list).getAllByRole('article')[0]).toHaveAttribute('data-unread', 'true')
  })

  it('shows a pushed notification at the top, keeping the highlights and marking read only once', async () => {
    const uninstall = installFakeEventSource()
    try {
      const pages = [[notification('n2', 'like'), notification('n3', 'follow', { read: true })]]
      const state = mockNotifications(pages)
      await renderNotifications()
      await waitFor(() => expect(state.readBodies).toHaveLength(1))
      FakeEventSource.latest.open()

      // The server now has the visit's row read and a newer unread one on top.
      pages[0] = [
        notification('n1', 'comment'),
        notification('n2', 'like', { read: true }),
        notification('n3', 'follow', { read: true }),
      ]
      FakeEventSource.latest.emit('notifications.changed', { unreadCount: 1 })

      const list = main().getByRole('list', { name: 'Notifications' })
      await waitFor(() => expect(within(list).getAllByRole('article')).toHaveLength(3))
      const rows = within(list).getAllByRole('article')
      expect(rows[0]).toHaveAccessibleName('Bob Builder commented on your post')
      expect(rows[0]).toHaveAttribute('data-unread', 'true')
      expect(rows[1]).toHaveAttribute('data-unread', 'true') // unread earlier in this visit
      expect(rows[2]).not.toHaveAttribute('data-unread')
      expect(state.readBodies).toHaveLength(1)
    } finally {
      uninstall()
    }
  })

  it('does not mark anything when the first page has no unread items', async () => {
    const state = mockNotifications([[notification('n1', 'follow', { read: true })]])
    await renderNotifications()

    await main().findByRole('list', { name: 'Notifications' })
    // Give a would-be mutation a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(state.readBodies).toEqual([])
  })

  it('shows an empty state and marks nothing', async () => {
    const state = mockNotifications([[]])
    await renderNotifications()

    expect(await main().findByRole('heading', { name: 'No notifications yet' })).toBeInTheDocument()
    expect(main().queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument()
    expect(state.readBodies).toEqual([])
  })

  it('shows an error with Retry when loading fails, and recovers', async () => {
    const state = mockNotifications([[notification('n1', 'follow')]])
    state.status = 500
    const { user } = await renderNotifications()

    expect(await screen.findByText(/Couldn't load your notifications/)).toBeInTheDocument()
    expect(state.readBodies).toEqual([])

    state.status = 200
    await user.click(main().getByRole('button', { name: 'Retry' }))

    expect(await main().findByRole('article', { name: 'Bob Builder followed you' })).toBeInTheDocument()
    await waitFor(() => expect(state.readBodies).toHaveLength(1))
  })
})
