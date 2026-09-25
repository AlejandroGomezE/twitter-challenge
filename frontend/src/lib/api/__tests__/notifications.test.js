import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiUrl, server } from '@/test/server'
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markNotificationsRead,
  notificationKeys,
} from '../notifications'

describe('notificationKeys', () => {
  it('keeps list and unread count as siblings under the notifications prefix', () => {
    expect(notificationKeys.all).toEqual(['notifications'])
    expect(notificationKeys.list()).toEqual(['notifications', 'list'])
    expect(notificationKeys.unreadCount()).toEqual(['notifications', 'unread-count'])
  })
})

describe('fetchNotifications', () => {
  const capture = () => {
    const seen = []
    server.use(
      http.get(apiUrl('/notifications'), ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json({ items: [], nextCursor: null })
      }),
    )
    return seen
  }

  it('sends no query params on the first page with no limit', async () => {
    const seen = capture()
    await expect(fetchNotifications(null)).resolves.toEqual({ items: [], nextCursor: null })
    expect([...seen[0].keys()]).toEqual([])
  })

  it('sends the cursor when there is one, and omits an unset limit', async () => {
    const seen = capture()
    await fetchNotifications('c1')
    expect(seen[0].get('cursor')).toBe('c1')
    expect(seen[0].has('limit')).toBe(false)
  })

  it('sends the limit when set, without a cursor on the first page', async () => {
    const seen = capture()
    await fetchNotifications(undefined, { limit: 5 })
    expect(seen[0].get('limit')).toBe('5')
    expect(seen[0].has('cursor')).toBe(false)
  })
})

describe('fetchUnreadNotificationCount', () => {
  it('returns { count }', async () => {
    server.use(
      http.get(apiUrl('/notifications/unread-count'), () => HttpResponse.json({ count: 4 })),
    )
    await expect(fetchUnreadNotificationCount()).resolves.toEqual({ count: 4 })
  })
})

describe('markNotificationsRead', () => {
  it('POSTs { until } and resolves a 204 to null', async () => {
    const bodies = []
    server.use(
      http.post(apiUrl('/notifications/read'), async ({ request }) => {
        bodies.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const until = '2026-09-24T12:00:00.000Z'

    await expect(markNotificationsRead(until)).resolves.toBeNull()
    expect(bodies).toEqual([{ until }])
  })
})
