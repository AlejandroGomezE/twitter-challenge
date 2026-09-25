import {
  QueryClientProvider,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import type { ApiError } from '@/lib/api/client'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { useAuth } from '@/lib/auth/use-auth'
import { postKeys } from '@/lib/api/posts'
import type { FollowState, FollowUser, Page, Profile } from '@/lib/api/types'
import { followKeys, profileQueryKey } from '@/lib/api/users'
import { apiUrl, server } from '@/test/server'
import { useProfile } from '../use-profile'
import { useFollowers, useFollowing, useSuggestions, useToggleFollow } from '../use-follows'

const row = (username: string, overrides: Partial<FollowUser> = {}) => ({
  username,
  bio: null,
  isFollowing: false,
  followsYou: false,
  ...overrides,
})

const profile = (username: string, overrides: Partial<Profile> = {}) => ({
  username,
  bio: null,
  createdAt: '2026-09-15T12:00:00.000Z',
  postCount: 0,
  followerCount: 4,
  followingCount: 2,
  isFollowing: false,
  followsYou: false,
  ...overrides,
})

type Row = ReturnType<typeof row>
type Rows = InfiniteData<Page<Row>>

const page = (items: Row[], nextCursor: string | null = null) => ({ items, nextCursor })
const infinite = (items: Row[]): Rows => ({ pages: [page(items)], pageParams: [null] })

// A promise the test resolves by hand, to control the order responses arrive in.
function gate() {
  let open!: (value?: unknown) => void
  const promise = new Promise<unknown>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

// A follow/unfollow handler that waits for `g` and then answers `result` (or a 500 when null).
type Gate = ReturnType<typeof gate>

const followHandler = (method: 'put' | 'delete', g: Gate, result: FollowState | null) =>
  http[method](apiUrl('/users/:username/follow'), async () => {
    await g.promise
    return result
      ? HttpResponse.json(result)
      : HttpResponse.json({ message: 'Boom' }, { status: 500 })
  })

function newWrapper() {
  const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
  return { queryClient, wrapper }
}

// Renders the follow mutation signed in as ada, with bob cached in his profile, in carol's
// followers list and in the suggestions, and ada's own profile cached.
// `T` is inferred from `extraHooks` when one is passed (the default adds nothing).
async function renderToggle<T extends object = object>(extraHooks: () => T = () => ({}) as T) {
  const { queryClient, wrapper } = newWrapper()
  const hook = renderHook(() => ({ toggle: useToggleFollow(), auth: useAuth(), ...extraHooks() }), {
    wrapper,
  })
  await waitFor(() => expect(hook.result.current.auth.user).not.toBeNull())
  queryClient.setQueryData(profileQueryKey('bob'), profile('bob'))
  queryClient.setQueryData(profileQueryKey('ada'), profile('ada'))
  queryClient.setQueryData(followKeys.followers('carol'), infinite([row('dan'), row('bob')]))
  queryClient.setQueryData(followKeys.suggestions(), { items: [row('bob')] })
  return { queryClient, ...hook }
}

const snapshot = (queryClient: QueryClient) => {
  const bob = queryClient.getQueryData<Profile>(profileQueryKey('bob'))
  const listRow = queryClient
    .getQueryData<Rows>(followKeys.followers('carol'))
    ?.pages[0].items.find((item) => item.username === 'bob')
  return {
    isFollowing: bob?.isFollowing,
    followerCount: bob?.followerCount,
    myFollowingCount: queryClient.getQueryData<Profile>(profileQueryKey('ada'))?.followingCount,
    listRow: listRow?.isFollowing,
    suggestion: queryClient.getQueryData<Page<Row>>(followKeys.suggestions())?.items[0].isFollowing,
  }
}

const unfollowed = {
  isFollowing: false,
  followerCount: 4,
  myFollowingCount: 2,
  listRow: false,
  suggestion: false,
}
const followedOptimistic = {
  isFollowing: true,
  followerCount: 5,
  myFollowingCount: 3,
  listRow: true,
  suggestion: true,
}

// Waits until no mutation is pending and no cache write is left to settle.
const settled = (queryClient: QueryClient) => waitFor(() => expect(queryClient.isMutating()).toBe(0))

describe('useFollowers / useFollowing', () => {
  it('pages through a user’s followers by cursor', async () => {
    const cursors: (string | null)[] = []
    server.use(
      http.get(apiUrl('/users/:username/followers'), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor
          ? HttpResponse.json(page([row('carol')]))
          : HttpResponse.json(page([row('bob')], 'c1'))
      }),
    )
    const { wrapper } = newWrapper()
    const { result } = renderHook(() => useFollowers('Ada'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(true)

    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    const usernames = result.current.data?.pages.flatMap((p) => p.items.map((item) => item.username))
    expect(usernames).toEqual(['bob', 'carol'])
    expect(cursors).toEqual([null, 'c1'])
    expect(result.current.hasNextPage).toBe(false)
  })

  it('does not retry a 404 for an unknown user, and waits while disabled', async () => {
    const { wrapper, queryClient } = newWrapper()
    const { result, rerender } = renderHook(({ enabled }) => useFollowing('ghost', { enabled }), {
      wrapper,
      initialProps: { enabled: false },
    })
    expect(queryClient.getQueryState(followKeys.following('ghost'))?.fetchStatus).toBe('idle')

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError | null)?.status).toBe(404)
  })
})

describe('useSuggestions', () => {
  it('loads the suggestions', async () => {
    server.use(
      http.get(apiUrl('/users/me/suggestions'), () =>
        HttpResponse.json({ items: [row('bob'), row('carol')] }),
      ),
    )
    const { wrapper } = newWrapper()
    const { result } = renderHook(() => useSuggestions(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items.map((item) => item.username)).toEqual(['bob', 'carol'])
  })
})

describe('useToggleFollow', () => {
  it('flips every cached copy optimistically, then reconciles and invalidates', async () => {
    const put = gate()
    server.use(followHandler('put', put, { following: true, followerCount: 9 }))
    const { result, queryClient } = await renderToggle()
    queryClient.setQueryData(postKeys.feed(), infinite([]))
    queryClient.setQueryData(postKeys.forYou(), infinite([]))
    queryClient.setQueryData(followKeys.followers('bob'), infinite([]))
    queryClient.setQueryData(followKeys.following('ada'), infinite([]))

    act(() => result.current.toggle.mutate({ username: 'Bob', following: true }))
    await waitFor(() => expect(snapshot(queryClient)).toEqual(followedOptimistic))
    // The untouched row keeps its identity.
    expect(
      queryClient.getQueryData<Rows>(followKeys.followers('carol'))?.pages[0].items[0],
    ).toEqual(row('dan'))

    put.open()
    await settled(queryClient)
    expect(snapshot(queryClient)).toEqual({ ...followedOptimistic, followerCount: 9 })

    const invalidated = (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated
    expect(invalidated(postKeys.feed())).toBe(true)
    expect(invalidated(followKeys.suggestions())).toBe(true)
    expect(invalidated(followKeys.followers('bob'))).toBe(true)
    expect(invalidated(followKeys.following('ada'))).toBe(true)
    expect(invalidated(postKeys.forYou())).toBe(false)
  })

  it('rolls back a failed follow and invalidates nothing', async () => {
    const put = gate()
    server.use(followHandler('put', put, null))
    const { result, queryClient } = await renderToggle()
    queryClient.setQueryData(postKeys.feed(), infinite([]))

    act(() => result.current.toggle.mutate({ username: 'bob', following: true }))
    await waitFor(() => expect(snapshot(queryClient)).toEqual(followedOptimistic))

    put.open()
    await settled(queryClient)
    expect(snapshot(queryClient)).toEqual(unfollowed)
    expect(queryClient.getQueryState(postKeys.feed())?.isInvalidated).toBe(false)
  })

  // A double click: follow (PUT) then unfollow (DELETE), both in flight at once.
  interface DoubleClickOptions {
    putResult: FollowState | null
    deleteResult: FollowState | null
    order: ('put' | 'delete')[]
  }

  async function doubleClick({ putResult, deleteResult, order }: DoubleClickOptions) {
    const gates = { put: gate(), delete: gate() }
    server.use(
      followHandler('put', gates.put, putResult),
      followHandler('delete', gates.delete, deleteResult),
    )
    const { result, queryClient } = await renderToggle()

    act(() => result.current.toggle.mutate({ username: 'bob', following: true }))
    await waitFor(() => expect(snapshot(queryClient).isFollowing).toBe(true))
    act(() => result.current.toggle.mutate({ username: 'bob', following: false }))
    await waitFor(() => expect(snapshot(queryClient)).toEqual(unfollowed))

    for (const [index, method] of order.entries()) {
      gates[method].open()
      await waitFor(() => expect(queryClient.isMutating()).toBe(order.length - 1 - index))
    }
    return snapshot(queryClient)
  }

  it('ends in the latest state when every request succeeds (even out of order)', async () => {
    const state = await doubleClick({
      putResult: { following: true, followerCount: 5 },
      deleteResult: { following: false, followerCount: 7 },
      order: ['delete', 'put'],
    })
    expect(state).toEqual({ ...unfollowed, followerCount: 7 })
  })

  it('falls back to the earlier confirmed state when the latest request fails', async () => {
    const state = await doubleClick({
      putResult: { following: true, followerCount: 10 },
      deleteResult: null,
      order: ['put', 'delete'],
    })
    expect(state).toEqual({ ...followedOptimistic, followerCount: 10 })
  })

  it('restores the state from before the burst when every request fails', async () => {
    const state = await doubleClick({
      putResult: null,
      deleteResult: null,
      order: ['delete', 'put'],
    })
    expect(state).toEqual(unfollowed)
  })

  it('is not overwritten by a profile refetch that started mid-flight and lands after it', async () => {
    const refetchGate = gate()
    let calls = 0
    server.use(
      http.get<{ username: string }>(apiUrl('/users/:username'), async ({ params }) => {
        if (params.username !== 'bob') return HttpResponse.json(profile(params.username))
        calls += 1
        if (calls > 1) await refetchGate.promise
        return HttpResponse.json(profile('bob'))
      }),
    )
    const put = gate()
    server.use(followHandler('put', put, { following: true, followerCount: 5 }))
    const { result, queryClient } = await renderToggle(() => ({ bob: useProfile('bob') }))
    await waitFor(() => expect(result.current.bob.isSuccess).toBe(true))

    act(() => result.current.toggle.mutate({ username: 'bob', following: true }))
    await waitFor(() => expect(snapshot(queryClient).isFollowing).toBe(true))
    act(() => {
      queryClient.refetchQueries({ queryKey: profileQueryKey('bob') })
    })
    put.open()
    await settled(queryClient)

    refetchGate.open()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(snapshot(queryClient)).toEqual(followedOptimistic)
  })

  describe('the caller’s own profile fetched mid-burst', () => {
    // Serves ada's profile with a `followingCount` that follows the server's follow state of bob
    // (2 + 1 while following); PUT / DELETE wait for their gate, then apply and answer.
    function mockServer() {
      const server_ = { following: false, adaRequests: 0, put: gate(), delete: gate() }
      const count = () => 2 + (server_.following ? 1 : 0)
      server.use(
        http.get<{ username: string }>(apiUrl('/users/:username'), ({ params }) => {
          if (params.username !== 'ada') return HttpResponse.json(profile(params.username))
          server_.adaRequests += 1
          return HttpResponse.json(profile('ada', { followingCount: count() }))
        }),
        ...(['put', 'delete'] as const).map((method) =>
          http[method](apiUrl('/users/:username/follow'), async () => {
            await server_[method].promise
            server_.following = method === 'put'
            return HttpResponse.json({ following: server_.following, followerCount: 4 + (server_.following ? 1 : 0) })
          }),
        ),
      )
      return server_
    }

    const myCount = (queryClient: QueryClient) =>
      queryClient.getQueryData<Profile>(profileQueryKey('ada'))?.followingCount
    const refetchMe = (queryClient: QueryClient) =>
      act(() => queryClient.refetchQueries({ queryKey: profileQueryKey('ada'), exact: true }))

    it('keeps the optimistic followingCount when the refetch lands before the follow settles', async () => {
      const state = mockServer()
      const { result, queryClient } = await renderToggle(() => ({ me: useProfile('ada') }))
      await waitFor(() => expect(queryClient.isFetching()).toBe(0))

      act(() => result.current.toggle.mutate({ username: 'bob', following: true }))
      await waitFor(() => expect(myCount(queryClient)).toBe(3))

      // The server hasn't applied the follow yet: it answers 2.
      const before = state.adaRequests
      await refetchMe(queryClient)
      expect(state.adaRequests).toBe(before + 1)
      expect(myCount(queryClient)).toBe(3)

      state.put.open()
      await settled(queryClient)
      await waitFor(() => expect(queryClient.isFetching()).toBe(0))
      // Settling refetched the caller's profile (the server's count), without double-counting.
      expect(state.adaRequests).toBe(before + 2)
      expect(myCount(queryClient)).toBe(3)
    })

    it('ends with the right followingCount after a follow → unfollow burst', async () => {
      const state = mockServer()
      const { result, queryClient } = await renderToggle(() => ({ me: useProfile('ada') }))
      await waitFor(() => expect(queryClient.isFetching()).toBe(0))

      act(() => result.current.toggle.mutate({ username: 'bob', following: true }))
      await waitFor(() => expect(myCount(queryClient)).toBe(3))
      await refetchMe(queryClient)
      expect(myCount(queryClient)).toBe(3)

      act(() => result.current.toggle.mutate({ username: 'bob', following: false }))
      await waitFor(() => expect(myCount(queryClient)).toBe(2))

      state.put.open()
      await waitFor(() => expect(queryClient.isMutating()).toBe(1))
      state.delete.open()
      await settled(queryClient)
      await waitFor(() => expect(queryClient.isFetching()).toBe(0))
      expect(state.following).toBe(false)
      expect(myCount(queryClient)).toBe(2)
    })
  })

  it('refetches the caller’s profile when the starting state was not cached', async () => {
    const { result, queryClient } = await renderToggle()
    queryClient.removeQueries({ queryKey: profileQueryKey('bob'), exact: true })
    queryClient.setQueryData(followKeys.suggestions(), { items: [] })
    queryClient.setQueryData(followKeys.followers('carol'), infinite([]))

    await act(() => result.current.toggle.mutateAsync({ username: 'bob', following: true }))
    await settled(queryClient)
    // The own count wasn't guessed; the profile is refetched instead.
    expect(queryClient.getQueryState(profileQueryKey('ada'))?.isInvalidated).toBe(true)
  })

  it('doesn’t let a follow still in flight at sign-out write into the next session’s cache', async () => {
    server.use(http.post(apiUrl('/auth/sign-out'), () => new HttpResponse(null, { status: 204 })))
    const put = gate()
    server.use(followHandler('put', put, { following: true, followerCount: 5 }))
    const { result, queryClient } = await renderToggle()

    let pending: Promise<unknown> | undefined
    act(() => {
      pending = result.current.toggle.mutateAsync({ username: 'bob', following: true })
    })
    await waitFor(() => expect(snapshot(queryClient).isFollowing).toBe(true))

    await act(() => result.current.auth.signOut())
    expect(queryClient.getQueryData(profileQueryKey('bob'))).toBeUndefined()
    // The next session loads bob, whom it doesn't follow.
    queryClient.setQueryData(profileQueryKey('bob'), profile('bob'))

    put.open()
    await act(() => pending)
    expect(queryClient.getQueryData(profileQueryKey('bob'))).toEqual(profile('bob'))
  })
})
