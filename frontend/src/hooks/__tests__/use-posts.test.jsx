import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { useAuth } from '@/lib/auth/use-auth'
import { postKeys } from '@/lib/api/posts'
import { profileQueryKey } from '@/lib/api/users'
import { apiUrl, server } from '@/test/server'
import { useCreatePost, useDeletePost, useFeed, useForYouFeed, useToggleLike } from '../use-posts'

const post = (id, overrides = {}) => ({
  id,
  body: `post ${id}`,
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'ada' },
  likeCount: 5,
  commentCount: 0,
  likedByMe: false,
  ...overrides,
})

// A promise the test resolves by hand, to control the order responses arrive in.
function gate() {
  let open
  const promise = new Promise((resolve) => {
    open = resolve
  })
  return { promise, open }
}

// `GET /feed`: the first request answers `initial` at once; later ones (refetches) wait for
// `refetchGate` and answer `refetched` — a snapshot the server served before a write landed.
function mockFeed(initial, { refetched = initial, refetchGate } = {}) {
  let calls = 0
  server.use(
    http.get(apiUrl('/feed'), async () => {
      calls += 1
      if (calls > 1 && refetchGate) await refetchGate.promise
      return HttpResponse.json({ items: calls > 1 ? refetched : initial, nextCursor: null })
    }),
  )
}

// A like/unlike handler that waits for `g` and then answers `result` (or a 500 when null).
const likeHandler = (method, g, result) =>
  http[method](apiUrl('/posts/:id/like'), async () => {
    await g.promise
    return result
      ? HttpResponse.json(result)
      : HttpResponse.json({ message: 'Boom' }, { status: 500 })
  })

async function renderPosts() {
  const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () => ({
      feed: useFeed(),
      like: useToggleLike(),
      create: useCreatePost(),
      remove: useDeletePost(),
    }),
    { wrapper },
  )
  await waitFor(() => expect(hook.result.current.feed.isSuccess).toBe(true))
  return { queryClient, ...hook }
}

const feedItems = (queryClient) =>
  queryClient.getQueryData(postKeys.feed()).pages.flatMap((page) => page.items)

const likeState = (queryClient, id = 'p1') => {
  const found = feedItems(queryClient).find((item) => item.id === id)
  return { liked: found.likedByMe, likeCount: found.likeCount }
}

// Waits until no mutation is pending and no cache write is left to settle.
const settled = (queryClient) =>
  waitFor(() => expect(queryClient.isMutating()).toBe(0))

describe('useToggleLike', () => {
  it('flips the post optimistically and settles with the server state', async () => {
    mockFeed([post('p1')])
    const put = gate()
    server.use(likeHandler('put', put, { liked: true, likeCount: 9 }))
    const { result, queryClient } = await renderPosts()

    act(() => result.current.like.mutate({ postId: 'p1', liked: true }))
    await waitFor(() => expect(likeState(queryClient)).toEqual({ liked: true, likeCount: 6 }))

    put.open()
    await settled(queryClient)
    expect(likeState(queryClient)).toEqual({ liked: true, likeCount: 9 })
  })

  it('rolls back a single failed like', async () => {
    mockFeed([post('p1')])
    const put = gate()
    server.use(likeHandler('put', put, null))
    const { result, queryClient } = await renderPosts()

    act(() => result.current.like.mutate({ postId: 'p1', liked: true }))
    await waitFor(() => expect(likeState(queryClient).liked).toBe(true))

    put.open()
    await settled(queryClient)
    expect(likeState(queryClient)).toEqual({ liked: false, likeCount: 5 })
  })

  // A double click: like (PUT) then unlike (DELETE), both in flight at once.
  async function doubleClick({ putResult, deleteResult, order }) {
    mockFeed([post('p1')])
    const gates = { put: gate(), delete: gate() }
    server.use(
      likeHandler('put', gates.put, putResult),
      likeHandler('delete', gates.delete, deleteResult),
    )
    const { result, queryClient } = await renderPosts()

    act(() => result.current.like.mutate({ postId: 'p1', liked: true }))
    await waitFor(() => expect(likeState(queryClient).liked).toBe(true))
    act(() => result.current.like.mutate({ postId: 'p1', liked: false }))
    await waitFor(() => expect(likeState(queryClient)).toEqual({ liked: false, likeCount: 5 }))

    // Let the responses arrive one at a time, in `order`.
    for (const [index, method] of order.entries()) {
      gates[method].open()
      await waitFor(() => expect(queryClient.isMutating()).toBe(order.length - 1 - index))
    }
    return likeState(queryClient)
  }

  it('ends in the latest state when every request succeeds (even out of order)', async () => {
    const state = await doubleClick({
      putResult: { liked: true, likeCount: 6 },
      deleteResult: { liked: false, likeCount: 7 },
      order: ['delete', 'put'],
    })
    expect(state).toEqual({ liked: false, likeCount: 7 })
  })

  it('falls back to the earlier confirmed state when the latest request fails', async () => {
    const state = await doubleClick({
      putResult: { liked: true, likeCount: 10 },
      deleteResult: null,
      order: ['put', 'delete'],
    })
    expect(state).toEqual({ liked: true, likeCount: 10 })
  })

  it('keeps the latest state when an earlier request fails and the latest succeeds', async () => {
    const state = await doubleClick({
      putResult: null,
      deleteResult: { liked: false, likeCount: 4 },
      order: ['put', 'delete'],
    })
    expect(state).toEqual({ liked: false, likeCount: 4 })
  })

  it('restores the state from before the burst when every request fails', async () => {
    const state = await doubleClick({
      putResult: null,
      deleteResult: null,
      order: ['delete', 'put'],
    })
    expect(state).toEqual({ liked: false, likeCount: 5 })
  })

  it('is not overwritten by a feed refetch that started before the like', async () => {
    const refetchGate = gate()
    mockFeed([post('p1')], { refetched: [post('p1')], refetchGate })
    const put = gate()
    server.use(likeHandler('put', put, { liked: true, likeCount: 6 }))
    const { result, queryClient } = await renderPosts()

    act(() => {
      queryClient.refetchQueries({ queryKey: postKeys.feed() })
    })
    act(() => result.current.like.mutate({ postId: 'p1', liked: true }))
    put.open()
    await settled(queryClient)

    refetchGate.open()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(likeState(queryClient)).toEqual({ liked: true, likeCount: 6 })
  })

  it('is not overwritten by a feed refetch that started mid-flight and lands after it', async () => {
    const refetchGate = gate()
    mockFeed([post('p1')], { refetched: [post('p1')], refetchGate })
    const put = gate()
    server.use(likeHandler('put', put, { liked: true, likeCount: 6 }))
    const { result, queryClient } = await renderPosts()

    act(() => result.current.like.mutate({ postId: 'p1', liked: true }))
    await waitFor(() => expect(likeState(queryClient).liked).toBe(true))
    act(() => {
      queryClient.refetchQueries({ queryKey: postKeys.feed() })
    })
    put.open()
    await settled(queryClient)

    refetchGate.open()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(likeState(queryClient)).toEqual({ liked: true, likeCount: 6 })
  })
})

describe('useCreatePost / useDeletePost', () => {
  it('keeps a created post when a stale feed refetch lands afterwards', async () => {
    const refetchGate = gate()
    mockFeed([post('p1')], { refetched: [post('p1')], refetchGate })
    server.use(http.post(apiUrl('/posts'), () => HttpResponse.json(post('p2'), { status: 201 })))
    const { result, queryClient } = await renderPosts()
    queryClient.setQueryData(profileQueryKey('ada'), { username: 'ada', postCount: 1 })

    act(() => {
      queryClient.refetchQueries({ queryKey: postKeys.feed() })
    })
    await act(() => result.current.create.mutateAsync('post p2'))

    refetchGate.open()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(feedItems(queryClient).map((item) => item.id)).toEqual(['p2', 'p1'])
    expect(queryClient.getQueryData(postKeys.detail('p2'))).toEqual(post('p2'))
    expect(queryClient.getQueryData(profileQueryKey('ada')).postCount).toBe(2)
  })

  it('keeps a deleted post out when a stale feed refetch lands afterwards', async () => {
    const refetchGate = gate()
    mockFeed([post('p1'), post('p2')], { refetched: [post('p1'), post('p2')], refetchGate })
    server.use(http.delete(apiUrl('/posts/:id'), () => new HttpResponse(null, { status: 204 })))
    const { result, queryClient } = await renderPosts()
    queryClient.setQueryData(postKeys.detail('p1'), post('p1'))
    queryClient.setQueryData(profileQueryKey('ada'), { username: 'ada', postCount: 2 })

    act(() => {
      queryClient.refetchQueries({ queryKey: postKeys.feed() })
    })
    await act(() => result.current.remove.mutateAsync(post('p1')))

    refetchGate.open()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(feedItems(queryClient).map((item) => item.id)).toEqual(['p2'])
    expect(queryClient.getQueryData(postKeys.detail('p1'))).toBeUndefined()
    expect(queryClient.getQueryData(profileQueryKey('ada')).postCount).toBe(1)
  })
})

describe('useForYouFeed', () => {
  const forYouItems = (queryClient) =>
    queryClient.getQueryData(postKeys.forYou()).pages.flatMap((page) => page.items)

  async function renderBothFeeds() {
    mockFeed([post('p1')])
    server.use(
      http.get(apiUrl('/feed/for-you'), () =>
        HttpResponse.json({ items: [post('p1'), post('p9', { author: { username: 'bob' } })], nextCursor: null }),
      ),
    )
    const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const hook = renderHook(
      () => ({
        feed: useFeed(),
        forYou: useForYouFeed(),
        like: useToggleLike(),
        create: useCreatePost(),
        remove: useDeletePost(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(hook.result.current.forYou.isSuccess).toBe(true))
    await waitFor(() => expect(hook.result.current.feed.isSuccess).toBe(true))
    return { queryClient, ...hook }
  }

  it('loads every user’s posts from GET /feed/for-you, apart from the Following feed', async () => {
    const { queryClient } = await renderBothFeeds()
    expect(forYouItems(queryClient).map((item) => item.id)).toEqual(['p1', 'p9'])
    expect(feedItems(queryClient).map((item) => item.id)).toEqual(['p1'])
  })

  it('gets likes, new posts and deletes like the Following feed', async () => {
    server.use(
      http.put(apiUrl('/posts/:id/like'), () => HttpResponse.json({ liked: true, likeCount: 8 })),
      http.post(apiUrl('/posts'), () => HttpResponse.json(post('p2'), { status: 201 })),
      http.delete(apiUrl('/posts/:id'), () => new HttpResponse(null, { status: 204 })),
    )
    const { result, queryClient } = await renderBothFeeds()

    await act(() => result.current.like.mutateAsync({ postId: 'p9', liked: true }))
    await settled(queryClient)
    expect(forYouItems(queryClient).find((item) => item.id === 'p9')).toMatchObject({
      likedByMe: true,
      likeCount: 8,
    })

    await act(() => result.current.create.mutateAsync('post p2'))
    expect(forYouItems(queryClient).map((item) => item.id)).toEqual(['p2', 'p1', 'p9'])
    expect(feedItems(queryClient).map((item) => item.id)).toEqual(['p2', 'p1'])

    await act(() => result.current.remove.mutateAsync(post('p1')))
    expect(forYouItems(queryClient).map((item) => item.id)).toEqual(['p2', 'p9'])
    expect(feedItems(queryClient).map((item) => item.id)).toEqual(['p2'])
  })
})

describe('like bursts across sign-out', () => {
  const seedFeed = (queryClient, items) =>
    queryClient.setQueryData(postKeys.feed(), {
      pages: [{ items, nextCursor: null }],
      pageParams: [null],
    })

  it("doesn't let a like still in flight at sign-out write into the next session's cache", async () => {
    server.use(http.post(apiUrl('/auth/sign-out'), () => new HttpResponse(null, { status: 204 })))
    const put = gate()
    server.use(likeHandler('put', put, { liked: true, likeCount: 6 }))
    const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => ({ like: useToggleLike(), auth: useAuth() }), { wrapper })
    await waitFor(() => expect(result.current.auth.user).not.toBeNull())
    seedFeed(queryClient, [post('p1')])

    let pending
    act(() => {
      pending = result.current.like.mutateAsync({ postId: 'p1', liked: true })
    })
    await waitFor(() => expect(likeState(queryClient)).toEqual({ liked: true, likeCount: 6 }))

    await act(() => result.current.auth.signOut())
    expect(queryClient.getQueryData(postKeys.feed())).toBeUndefined()
    // The next session loads the same post, which it hasn't liked.
    seedFeed(queryClient, [post('p1', { likeCount: 5, likedByMe: false })])

    // mutateAsync settles only after the mutation's own onSettled (and its cache write) ran.
    put.open()
    await act(() => pending)

    expect(likeState(queryClient)).toEqual({ liked: false, likeCount: 5 })
  })
})
