import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import { ApiError } from '@/lib/api/client'
import { fetchProfile, profileQueryKey } from '@/lib/api/users'
import { apiUrl, server } from '@/test/server'
import { useProfile } from './use-profile'

const PROFILE = { username: 'ada', bio: 'Hi', createdAt: '2026-09-01T12:00:00.000Z' }

// Records the raw request path of every `GET /users/*`, answering with `status`.
function mockProfile(status = 200) {
  const paths = []
  server.use(
    http.get(apiUrl('/users/*'), ({ request }) => {
      paths.push(new URL(request.url).pathname)
      if (status === 200) return HttpResponse.json(PROFILE)
      return HttpResponse.json({ message: 'nope' }, { status })
    }),
  )
  return paths
}

// `queries` overrides the app's QueryClient defaults (retryDelay 0 keeps retries instant).
function renderUseProfile(username, queries = {}) {
  const queryClient = createQueryClient({ queries: { retryDelay: 0, gcTime: Infinity, ...queries } })
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, ...renderHook(() => useProfile(username), { wrapper }) }
}

describe('profileQueryKey', () => {
  it('lowercases the username so /u/Ada and /u/ada share a cache entry', () => {
    expect(profileQueryKey('Ada')).toEqual(['users', 'ada', 'profile'])
    expect(profileQueryKey('Ada')).toEqual(profileQueryKey('ada'))
  })
})

describe('fetchProfile', () => {
  it('requests GET /users/:username', async () => {
    const paths = mockProfile()

    await expect(fetchProfile('ada')).resolves.toEqual(PROFILE)
    expect(paths).toEqual(['/users/ada'])
  })

  it('encodes the username as a single path segment', async () => {
    const paths = mockProfile()

    await fetchProfile('a/b')

    expect(paths).toEqual(['/users/a%2Fb'])
  })

  it('rejects with an ApiError carrying the status', async () => {
    mockProfile(404)

    await expect(fetchProfile('ghost')).rejects.toMatchObject({ name: 'ApiError', status: 404 })
  })
})

describe('useProfile', () => {
  it('loads the profile under the lowercased key', async () => {
    mockProfile()
    const { result, queryClient } = renderUseProfile('Ada')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(PROFILE)
    expect(queryClient.getQueryData(['users', 'ada', 'profile'])).toEqual(PROFILE)
  })

  it('never retries a 404', async () => {
    const paths = mockProfile(404)
    const { result } = renderUseProfile('ghost')

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error.status).toBe(404)
    expect(paths).toHaveLength(1)
  })

  it("uses the app client's default retry policy (one retry) for other errors", async () => {
    const paths = mockProfile(500)
    const { result } = renderUseProfile('ada')

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error.status).toBe(500)
    expect(paths).toHaveLength(2)
  })

  it('honours a numeric default retry count', async () => {
    const paths = mockProfile(500)
    const { result } = renderUseProfile('ada', { retry: 2 })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(paths).toHaveLength(3)
  })

  it('does not retry when the client disables retries', async () => {
    const paths = mockProfile(500)
    const { result } = renderUseProfile('ada', { retry: false })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(paths).toHaveLength(1)
  })
})
