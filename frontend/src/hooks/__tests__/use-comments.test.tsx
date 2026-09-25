import { QueryClientProvider, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import { postKeys } from '@/lib/api/posts'
import type { Page, Post } from '@/lib/api/types'
import { apiUrl, server } from '@/test/server'
import { useComments, useCreateComment, useDeleteComment } from '../use-comments'

const comment = (id: string) => ({
  id,
  body: `comment ${id}`,
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'ada' },
})

type TestComment = ReturnType<typeof comment>
type CommentsPage = Page<TestComment>

const post = {
  id: 'p1',
  body: 'post p1',
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'ada' },
  likeCount: 0,
  commentCount: 2,
  likedByMe: false,
}

// A promise the test resolves by hand, to control the order responses arrive in.
function gate() {
  let open!: (value?: unknown) => void
  const promise = new Promise<unknown>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

// `GET /posts/p1/comments`: the first request answers `page` at once; later ones (refetches) wait
// for `refetchGate` and answer `refetched` — a snapshot the server served before a write landed.
interface MockCommentsOptions {
  refetched?: CommentsPage
  refetchGate?: ReturnType<typeof gate>
}

function mockComments(page: CommentsPage, { refetched = page, refetchGate }: MockCommentsOptions = {}) {
  let calls = 0
  server.use(
    http.get(apiUrl('/posts/:id/comments'), async () => {
      calls += 1
      if (calls > 1 && refetchGate) await refetchGate.promise
      return HttpResponse.json(calls > 1 ? refetched : page)
    }),
  )
}

const mockCreate = (created: TestComment) =>
  server.use(http.post(apiUrl('/posts/:id/comments'), () => HttpResponse.json(created, { status: 201 })))

// The post is cached both in the feed and as its detail, like after opening it from Home.
async function renderComments() {
  const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })
  queryClient.setQueryData(postKeys.detail('p1'), post)
  queryClient.setQueryData(postKeys.feed(), {
    pages: [{ items: [post], nextCursor: null }],
    pageParams: [null],
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () => ({
      comments: useComments('p1'),
      create: useCreateComment('p1'),
      remove: useDeleteComment('p1'),
    }),
    { wrapper },
  )
  await waitFor(() => expect(hook.result.current.comments.isSuccess).toBe(true))
  return { queryClient, ...hook }
}

const commentIds = (queryClient: QueryClient) =>
  queryClient
    .getQueryData<InfiniteData<CommentsPage>>(postKeys.comments('p1'))
    ?.pages.flatMap((page) => page.items.map((item) => item.id))

// [detail, feed] commentCount of p1.
const commentCounts = (queryClient: QueryClient) => [
  queryClient.getQueryData<Post>(postKeys.detail('p1'))?.commentCount,
  queryClient.getQueryData<InfiniteData<Page<Post>>>(postKeys.feed())?.pages[0].items[0].commentCount,
]

describe('useCreateComment', () => {
  it('appends the comment when every page is loaded and bumps commentCount everywhere', async () => {
    mockComments({ items: [comment('c1'), comment('c2')], nextCursor: null })
    mockCreate(comment('c3'))
    const { result, queryClient } = await renderComments()

    await act(() => result.current.create.mutateAsync('comment c3'))
    expect(commentIds(queryClient)).toEqual(['c1', 'c2', 'c3'])
    expect(commentCounts(queryClient)).toEqual([3, 3])
  })

  it("doesn't append while later pages are unloaded, but still bumps the count", async () => {
    mockComments({ items: [comment('c1')], nextCursor: 'next' })
    mockCreate(comment('c3'))
    const { result, queryClient } = await renderComments()

    await act(() => result.current.create.mutateAsync('comment c3'))
    expect(commentIds(queryClient)).toEqual(['c1'])
    expect(commentCounts(queryClient)).toEqual([3, 3])
  })

  it('keeps the new comment when a stale comments refetch lands afterwards', async () => {
    const refetchGate = gate()
    mockComments({ items: [comment('c1')], nextCursor: null }, { refetchGate })
    mockCreate(comment('c2'))
    const { result, queryClient } = await renderComments()

    act(() => {
      queryClient.refetchQueries({ queryKey: postKeys.comments('p1') })
    })
    await act(() => result.current.create.mutateAsync('comment c2'))

    refetchGate.open()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(commentIds(queryClient)).toEqual(['c1', 'c2'])
  })
})

describe('useDeleteComment', () => {
  it('removes the comment and decrements commentCount everywhere', async () => {
    mockComments({ items: [comment('c1'), comment('c2')], nextCursor: null })
    server.use(
      http.delete(apiUrl('/posts/:id/comments/:commentId'), () => new HttpResponse(null, { status: 204 })),
    )
    const { result, queryClient } = await renderComments()

    await act(() => result.current.remove.mutateAsync('c1'))
    expect(commentIds(queryClient)).toEqual(['c2'])
    expect(commentCounts(queryClient)).toEqual([1, 1])
  })

  it('leaves the caches untouched when the delete is refused', async () => {
    mockComments({ items: [comment('c1')], nextCursor: null })
    server.use(
      http.delete(apiUrl('/posts/:id/comments/:commentId'), () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
      ),
    )
    const { result, queryClient } = await renderComments()

    await act(() => result.current.remove.mutateAsync('c1').catch(() => {}))
    expect(commentIds(queryClient)).toEqual(['c1'])
    expect(commentCounts(queryClient)).toEqual([2, 2])
  })
})
