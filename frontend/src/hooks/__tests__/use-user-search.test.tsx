import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import type { ApiError } from '@/lib/api/client'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { useAuth } from '@/lib/auth/use-auth'
import { searchKeys } from '@/lib/api/search'
import type { FollowUser, Page } from '@/lib/api/types'
import { apiUrl, server } from '@/test/server'
import { useToggleFollow } from '../use-follows'
import { TYPEAHEAD_DEBOUNCE_MS, useUserSearch, useUserTypeahead } from '../use-user-search'

const row = (username: string, overrides: Partial<FollowUser> = {}): FollowUser => ({
  username,
  displayName: null,
  bio: null,
  isFollowing: false,
  followsYou: false,
  ...overrides,
})

const page = (items: FollowUser[], nextCursor: string | null = null): Page<FollowUser> => ({
  items,
  nextCursor,
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// A promise the test resolves by hand, to hold a response until the test is ready.
function gate() {
  let open!: (value?: unknown) => void
  const promise = new Promise<unknown>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

function newWrapper() {
  const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
  return { queryClient, wrapper }
}

// Records the search params of every `GET /search/users` and answers with `respond(params)`.
type SearchResponse = Page<FollowUser> | Response

function captureSearches(
  respond: (params: URLSearchParams) => SearchResponse | Promise<SearchResponse> = () => page([]),
) {
  const seen: URLSearchParams[] = []
  server.use(
    http.get(apiUrl('/search/users'), async ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      const body = await respond(params)
      return body instanceof Response ? body : HttpResponse.json(body)
    }),
  )
  return seen
}

const usernames = (items?: FollowUser[]) => items?.map((item) => item.username)

describe('useUserTypeahead', () => {
  it('searches once, with the last value, after the input stops changing', async () => {
    const seen = captureSearches((params) => page([row((params.get('q') ?? '').toLowerCase())]))
    const { wrapper } = newWrapper()
    const { result, rerender } = renderHook(({ q }) => useUserTypeahead(q), {
      wrapper,
      initialProps: { q: '' },
    })
    rerender({ q: 'a' })
    rerender({ q: 'ad' })
    rerender({ q: '@Ada' })

    // Deterministic whatever the machine's speed: the request log shows that the intermediate
    // values never reached the server (the timer itself is covered in use-debounced-value.test).
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen.map((params) => params.get('q'))).toEqual(['Ada'])
    expect(seen[0].get('limit')).toBe('5')
    expect(seen[0].has('cursor')).toBe(false)
    expect(usernames(result.current.data?.items)).toEqual(['ada'])
  })

  it('stays disabled for empty, blank and @-only input', async () => {
    const seen = captureSearches()
    const { wrapper } = newWrapper()
    const { result, rerender } = renderHook(({ q }) => useUserTypeahead(q), {
      wrapper,
      initialProps: { q: '' },
    })
    await sleep(TYPEAHEAD_DEBOUNCE_MS + 100)
    rerender({ q: '  @ ' })
    await sleep(TYPEAHEAD_DEBOUNCE_MS + 100)

    expect(seen).toHaveLength(0)
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  it('keeps the previous results while the next query loads', async () => {
    const next = gate()
    captureSearches(async (params) => {
      if (params.get('q') === 'bo') {
        await next.promise
        return page([row('bob')])
      }
      return page([row('ada')])
    })
    const { wrapper } = newWrapper()
    const { result, rerender } = renderHook(({ q }) => useUserTypeahead(q), {
      wrapper,
      initialProps: { q: 'ad' },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ q: 'bo' })
    await waitFor(() => expect(result.current.isFetching).toBe(true))
    expect(result.current.isPlaceholderData).toBe(true)
    expect(usernames(result.current.data?.items)).toEqual(['ada'])

    next.open()
    await waitFor(() => expect(usernames(result.current.data?.items)).toEqual(['bob']))
    expect(result.current.isPlaceholderData).toBe(false)
  })

  it('does not retry a 400', async () => {
    const seen = captureSearches(() =>
      HttpResponse.json({ message: 'Bad query' }, { status: 400 }),
    )
    // The app's default policy retries once; a 400 must not be.
    const queryClient = createQueryClient({ queries: { gcTime: Infinity, retryDelay: 0 } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => useUserTypeahead('ada'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError | null)?.status).toBe(400)
    expect(seen).toHaveLength(1)
  })
})

describe('useUserSearch', () => {
  it('pages through the results by cursor, 20 at a time', async () => {
    const seen = captureSearches((params) =>
      params.get('cursor') ? page([row('carol')]) : page([row('ada'), row('bob')], 'c1'),
    )
    const { wrapper } = newWrapper()
    const { result } = renderHook(() => useUserSearch(' @A '), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(true)

    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(usernames(result.current.data?.pages.flatMap((p) => p.items))).toEqual([
      'ada',
      'bob',
      'carol',
    ])
    expect(seen.map((params) => [params.get('q'), params.get('cursor'), params.get('limit')])).toEqual(
      [
        ['A', null, '20'],
        ['A', 'c1', '20'],
      ],
    )
    expect(result.current.hasNextPage).toBe(false)
  })

  it('stays disabled for an empty query', async () => {
    const seen = captureSearches()
    const { wrapper } = newWrapper()
    const { result } = renderHook(() => useUserSearch('@'), { wrapper })
    await sleep(50)

    expect(seen).toHaveLength(0)
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })
})

describe('follow state in search results', () => {
  // Signed in as ada, with bob in both the typeahead and the Explore results for "bo".
  async function renderWithResults() {
    captureSearches(() => page([row('bob')]))
    const { queryClient, wrapper } = newWrapper()
    const hook = renderHook(
      () => ({
        toggle: useToggleFollow(),
        auth: useAuth(),
        typeahead: useUserTypeahead('bo'),
        search: useUserSearch('bo'),
      }),
      { wrapper },
    )
    await waitFor(() => {
      expect(hook.result.current.auth.user).not.toBeNull()
      expect(hook.result.current.typeahead.isSuccess).toBe(true)
      expect(hook.result.current.search.isSuccess).toBe(true)
    })
    return { queryClient, ...hook }
  }

  type ResultsHook = Awaited<ReturnType<typeof renderWithResults>>['result']

  const bobState = (result: ResultsHook) => ({
    typeahead: result.current.typeahead.data?.items[0].isFollowing,
    search: result.current.search.data?.pages[0].items[0].isFollowing,
  })

  it('flips the row in both result shapes optimistically and keeps the confirmed state', async () => {
    const response = gate()
    server.use(
      http.put(apiUrl('/users/:username/follow'), async () => {
        await response.promise
        return HttpResponse.json({ following: true, followerCount: 1 })
      }),
    )
    const { result, queryClient } = await renderWithResults()

    act(() => result.current.toggle.mutate({ username: 'bob', following: true }))
    await waitFor(() => expect(bobState(result)).toEqual({ typeahead: true, search: true }))

    response.open()
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(bobState(result)).toEqual({ typeahead: true, search: true })
    expect(
      queryClient.getQueryData<Page<FollowUser>>(searchKeys.userResults('bo', 'typeahead'))?.items[0]
        .isFollowing,
    ).toBe(true)
  })

  it('rolls the row back when the follow fails', async () => {
    const response = gate()
    server.use(
      http.put(apiUrl('/users/:username/follow'), async () => {
        await response.promise
        return HttpResponse.json({ message: 'Boom' }, { status: 500 })
      }),
    )
    const { result, queryClient } = await renderWithResults()

    act(() => result.current.toggle.mutate({ username: 'bob', following: true }))
    await waitFor(() => expect(bobState(result)).toEqual({ typeahead: true, search: true }))

    response.open()
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await waitFor(() => expect(bobState(result)).toEqual({ typeahead: false, search: false }))
  })

  it('keeps the optimistic state on a result page that lands mid-toggle', async () => {
    const response = gate()
    server.use(
      http.put(apiUrl('/users/:username/follow'), async () => {
        await response.promise
        return HttpResponse.json({ following: true, followerCount: 1 })
      }),
    )
    const { result, queryClient } = await renderWithResults()

    act(() => result.current.toggle.mutate({ username: 'bob', following: true }))
    await waitFor(() => expect(bobState(result)).toEqual({ typeahead: true, search: true }))

    // A refetch built before the follow was applied still says "not following".
    await act(() => queryClient.refetchQueries({ queryKey: searchKeys.all }))
    expect(bobState(result)).toEqual({ typeahead: true, search: true })

    response.open()
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(bobState(result)).toEqual({ typeahead: true, search: true })
  })
})
