import { MutationObserver } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError, apiClient } from '@/lib/api/client'
import { AUTH_ME_QUERY_KEY } from '@/lib/auth/auth-context'
import { apiUrl, server } from '@/test/server'
import { createQueryClient } from '../query-client'

const ADA = { id: 'u1', email: 'ada@example.com' }

// A query client with the app's defaults, a signed-in user and one unrelated cached query.
function seededClient() {
  const queryClient = createQueryClient()
  queryClient.setQueryData(AUTH_ME_QUERY_KEY, ADA)
  queryClient.setQueryData(['profile', 'u1'], { bio: 'hi' })
  return queryClient
}

// Serves GET /feed with `status`, counting the requests.
function mockFeed(status) {
  const calls = { count: 0 }
  server.use(
    http.get(apiUrl('/feed'), () => {
      calls.count += 1
      return HttpResponse.json({ message: 'nope' }, { status })
    }),
  )
  return calls
}

const fetchFeed = (queryClient) =>
  queryClient.fetchQuery({ queryKey: ['feed'], queryFn: () => apiClient.get('/feed'), retryDelay: 0 })

describe('createQueryClient', () => {
  it('on a 401 from any query, signs the user out and drops every other cached query', async () => {
    const queryClient = seededClient()
    const calls = mockFeed(401)

    await expect(fetchFeed(queryClient)).rejects.toMatchObject({ status: 401 })

    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull()
    expect(queryClient.getQueryCache().find({ queryKey: AUTH_ME_QUERY_KEY, exact: true })).toBeDefined()
    expect(queryClient.getQueryCache().find({ queryKey: ['profile', 'u1'] })).toBeUndefined()
    expect(queryClient.getQueryCache().find({ queryKey: ['feed'] })).toBeUndefined()
    // A 401 is not retried.
    expect(calls.count).toBe(1)
  })

  it('on a 401 from a mutation, signs the user out too', async () => {
    const queryClient = seededClient()
    server.use(http.post(apiUrl('/posts'), () => HttpResponse.json({ message: 'nope' }, { status: 401 })))
    const observer = new MutationObserver(queryClient, { mutationFn: () => apiClient.post('/posts', {}) })

    await expect(observer.mutate()).rejects.toMatchObject({ status: 401 })

    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull()
    expect(queryClient.getQueryCache().find({ queryKey: ['profile', 'u1'] })).toBeUndefined()
  })

  it('leaves the session alone on a 500 and retries it once', async () => {
    const queryClient = seededClient()
    const calls = mockFeed(500)

    await expect(fetchFeed(queryClient)).rejects.toMatchObject({ status: 500 })

    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toEqual(ADA)
    expect(queryClient.getQueryData(['profile', 'u1'])).toEqual({ bio: 'hi' })
    expect(calls.count).toBe(2)
  })

  it('configures retry: never for a 401, once for other errors', () => {
    const { retry } = createQueryClient().getDefaultOptions().queries
    const unauthorized = new ApiError(401, 'Unauthorized')
    const serverError = new ApiError(500, 'Server error')

    expect(retry(0, unauthorized)).toBe(false)
    expect(retry(0, serverError)).toBe(true)
    expect(retry(1, serverError)).toBe(false)
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true)
  })

  it('lets callers override query defaults', () => {
    const { retry, staleTime } = createQueryClient({ queries: { retry: false } }).getDefaultOptions().queries

    expect(retry).toBe(false)
    expect(staleTime).toBe(30_000)
  })
})
