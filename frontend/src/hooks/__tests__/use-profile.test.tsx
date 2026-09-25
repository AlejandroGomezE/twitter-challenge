import { QueryClientProvider, type DefaultOptions } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import { ApiError } from '@/lib/api/client'
import { fetchProfile, profileQueryKey } from '@/lib/api/users'
import { apiUrl, server } from '@/test/server'
import { useProfile, type ProfileOptions } from '../use-profile'

const PROFILE = { username: 'ada', bio: 'Hi', createdAt: '2026-09-01T12:00:00.000Z' }

// Records the raw request path of every `GET /users/*`, answering with `status`.
function mockProfile(status = 200) {
  const paths: string[] = []
  server.use(
    http.get(apiUrl('/users/*'), ({ request }) => {
      paths.push(new URL(request.url).pathname)
      if (status === 200) return HttpResponse.json(PROFILE)
      return HttpResponse.json({ message: 'nope' }, { status })
    }),
  )
  return paths
}

// `queries` overrides the app's QueryClient defaults (retryDelay 0 keeps retries instant);
// `options` is passed to useProfile. `renderAnother()` mounts a second observer on the same client.
function renderUseProfile(
  username: string,
  queries: DefaultOptions['queries'] = {},
  options?: ProfileOptions,
) {
  const queryClient = createQueryClient({ queries: { retryDelay: 0, gcTime: Infinity, ...queries } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const renderAnother = () => renderHook(() => useProfile(username, options), { wrapper })
  return { queryClient, renderAnother, ...renderHook(() => useProfile(username, options), { wrapper }) }
}

// Answers every `GET /users/*` with PROFILE whose bio is `bio-<n>` (n = 1-based request count).
function mockCountedProfile() {
  const paths: string[] = []
  server.use(
    http.get(apiUrl('/users/*'), ({ request }) => {
      paths.push(new URL(request.url).pathname)
      return HttpResponse.json({ ...PROFILE, bio: `bio-${paths.length}` })
    }),
  )
  return paths
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

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
    expect((result.current.error as ApiError | null)?.status).toBe(404)
    expect(paths).toHaveLength(1)
  })

  it("uses the app client's default retry policy (one retry) for other errors", async () => {
    const paths = mockProfile(500)
    const { result } = renderUseProfile('ada')

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect((result.current.error as ApiError | null)?.status).toBe(500)
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

  it('with alwaysFresh, refetches when a second observer mounts within 30s, showing cached data meanwhile', async () => {
    const paths = mockCountedProfile()
    const { result, renderAnother } = renderUseProfile('ada', {}, { alwaysFresh: true })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(paths).toHaveLength(1)

    const second = renderAnother()

    expect(second.result.current.data).toEqual({ ...PROFILE, bio: 'bio-1' })
    expect(second.result.current.isFetching).toBe(true)
    await waitFor(() => expect(second.result.current.data?.bio).toBe('bio-2'))
    expect(paths).toHaveLength(2)
  })

  it('without alwaysFresh, does not refetch when a second observer mounts within 30s', async () => {
    const paths = mockCountedProfile()
    const { result, renderAnother } = renderUseProfile('ada')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const second = renderAnother()

    expect(second.result.current.data).toEqual({ ...PROFILE, bio: 'bio-1' })
    expect(second.result.current.isFetching).toBe(false)
    await flush()
    expect(paths).toHaveLength(1)
  })
})
