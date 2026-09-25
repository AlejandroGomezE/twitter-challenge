import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import { notificationKeys } from '@/lib/api/notifications'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'
import { FakeEventSource, installFakeEventSource } from '@/test/fake-event-source'
import { apiUrl, server } from '@/test/server'
import {
  UNREAD_COUNT_REFETCH_INTERVAL,
  useMarkNotificationsRead,
  useNotifications,
  useNotificationsRealtimeSync,
  useUnreadNotificationCount,
} from '../use-notifications'

const notification = (id, overrides = {}) => ({
  id,
  type: 'follow',
  createdAt: '2026-09-24T12:00:00.000Z',
  read: false,
  actor: { username: 'grace', displayName: null },
  post: null,
  comment: null,
  ...overrides,
})

const page = (items, nextCursor = null) => ({ items, nextCursor })

// `realtime: true` adds the signed-in AuthProvider + RealtimeProvider (a stream opens once `GET
// /auth/me` resolves, if `window.EventSource` exists).
function renderWithClient(useHooks, { realtime = false } = {}) {
  const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {realtime ? (
        <AuthProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
        </AuthProvider>
      ) : (
        children
      )}
    </QueryClientProvider>
  )
  return { queryClient, ...renderHook(useHooks, { wrapper }) }
}

const unreadCountOptions = (queryClient) =>
  queryClient.getQueryCache().find({ queryKey: notificationKeys.unreadCount(), exact: true })
    .options

// `GET /notifications`: the first page (no cursor) points at 'c1'; the `c1` page is the last.
// Records the cursor of every request.
function mockList() {
  const cursors = []
  server.use(
    http.get(apiUrl('/notifications'), ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      cursors.push(cursor)
      return cursor
        ? HttpResponse.json(page([notification('n2', { read: true })]))
        : HttpResponse.json(page([notification('n1')], 'c1'))
    }),
  )
  return cursors
}

// `GET /notifications/unread-count`: answers `counts[i]` for the i-th request (the last one
// repeats). Returns the request log.
function mockUnreadCount(...counts) {
  const calls = { count: 0 }
  server.use(
    http.get(apiUrl('/notifications/unread-count'), () => {
      const count = counts[Math.min(calls.count, counts.length - 1)]
      calls.count += 1
      return HttpResponse.json({ count })
    }),
  )
  return calls
}

describe('useNotifications', () => {
  it('loads the first page without a cursor and pages on by nextCursor', async () => {
    const cursors = mockList()
    const { result } = renderWithClient(() => useNotifications())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.pages).toEqual([page([notification('n1')], 'c1')])
    expect(result.current.hasNextPage).toBe(true)
    expect(cursors).toEqual([null])

    await act(() => result.current.fetchNextPage())

    await waitFor(() => expect(result.current.data.pages).toHaveLength(2))
    expect(result.current.data.pages[1]).toEqual(page([notification('n2', { read: true })]))
    expect(result.current.hasNextPage).toBe(false)
    expect(cursors).toEqual([null, 'c1'])
  })

  it('caches the pages under the notifications list key', async () => {
    mockList()
    const { result, queryClient } = renderWithClient(() => useNotifications())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(notificationKeys.list()).pages).toHaveLength(1)
  })
})

describe('useUnreadNotificationCount', () => {
  it('returns the unread count', async () => {
    mockUnreadCount(7)
    const { result } = renderWithClient(() => useUnreadNotificationCount())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ count: 7 })
  })

  it('polls every 30s without a stream and refetches on window focus', async () => {
    mockUnreadCount(0)
    const { result, queryClient } = renderWithClient(() => useUnreadNotificationCount())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(UNREAD_COUNT_REFETCH_INTERVAL).toBe(30_000)
    // No realtime stream here (no provider), so the polling fallback is on.
    const options = unreadCountOptions(queryClient)
    expect(options.refetchInterval).toBe(UNREAD_COUNT_REFETCH_INTERVAL)
    expect(options.refetchOnWindowFocus).toBe(true)
  })
})

describe('useMarkNotificationsRead', () => {
  it('POSTs { until }, refetches the unread count and leaves the loaded list alone', async () => {
    const listCursors = mockList()
    const countCalls = mockUnreadCount(2, 0)
    const bodies = []
    server.use(
      http.post(apiUrl('/notifications/read'), async ({ request }) => {
        bodies.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { result } = renderWithClient(() => ({
      list: useNotifications(),
      count: useUnreadNotificationCount(),
      markRead: useMarkNotificationsRead(),
    }))
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.count.data).toEqual({ count: 2 }))
    const listBefore = result.current.list.data

    const until = '2026-09-24T12:00:00.000Z'
    await act(() => result.current.markRead.mutateAsync(until))

    expect(bodies).toEqual([{ until }])
    await waitFor(() => expect(result.current.count.data).toEqual({ count: 0 }))
    expect(countCalls.count).toBe(2)
    // The list is not refetched: still one request, same data (rows keep their `read: false`).
    expect(listCursors).toEqual([null])
    expect(result.current.list.data).toBe(listBefore)
    expect(result.current.list.isFetching).toBe(false)
  })

  it('does not touch the unread count when the request fails', async () => {
    const countCalls = mockUnreadCount(2)
    server.use(
      http.post(apiUrl('/notifications/read'), () =>
        HttpResponse.json({ message: 'Boom' }, { status: 500 }),
      ),
    )
    const { result } = renderWithClient(() => ({
      count: useUnreadNotificationCount(),
      markRead: useMarkNotificationsRead(),
    }))
    await waitFor(() => expect(result.current.count.isSuccess).toBe(true))

    await act(async () => {
      await expect(
        result.current.markRead.mutateAsync('2026-09-24T12:00:00.000Z'),
      ).rejects.toMatchObject({ status: 500 })
    })

    expect(countCalls.count).toBe(1)
    expect(result.current.count.data).toEqual({ count: 2 })
  })
})

describe('notifications over the realtime stream', () => {
  let uninstall
  beforeEach(() => {
    uninstall = installFakeEventSource()
  })
  afterEach(() => uninstall())

  async function renderSynced() {
    const cursors = mockList()
    const countCalls = mockUnreadCount(2)
    const utils = renderWithClient(
      () => {
        useNotificationsRealtimeSync()
        return { list: useNotifications(), count: useUnreadNotificationCount() }
      },
      { realtime: true },
    )
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    await waitFor(() => expect(utils.result.current.list.isSuccess).toBe(true))
    await waitFor(() => expect(utils.result.current.count.data).toEqual({ count: 2 }))
    return { ...utils, cursors, countCalls }
  }

  it('notifications.changed sets the unread count and refetches the list', async () => {
    const { result, cursors, countCalls } = await renderSynced()
    FakeEventSource.latest.open()

    FakeEventSource.latest.emit('notifications.changed', { unreadCount: 5 })

    await waitFor(() => expect(result.current.count.data).toEqual({ count: 5 }))
    await waitFor(() => expect(cursors).toEqual([null, null]))
    // The count came from the push, not a request.
    expect(countCalls.count).toBe(1)
  })

  it('refetches the unread count after a reconnect, not after the first open', async () => {
    const { countCalls } = await renderSynced()
    FakeEventSource.latest.open()
    expect(countCalls.count).toBe(1)

    FakeEventSource.latest.drop()
    FakeEventSource.latest.open()

    await waitFor(() => expect(countCalls.count).toBe(2))
  })

  it('stops polling the unread count while the stream is open, keeping focus refetch', async () => {
    const { queryClient } = await renderSynced()
    expect(unreadCountOptions(queryClient).refetchInterval).toBe(UNREAD_COUNT_REFETCH_INTERVAL)

    FakeEventSource.latest.open()
    await waitFor(() => expect(unreadCountOptions(queryClient).refetchInterval).toBe(false))
    expect(unreadCountOptions(queryClient).refetchOnWindowFocus).toBe(true)

    FakeEventSource.latest.fail()
    await waitFor(() =>
      expect(unreadCountOptions(queryClient).refetchInterval).toBe(UNREAD_COUNT_REFETCH_INTERVAL),
    )
  })
})
