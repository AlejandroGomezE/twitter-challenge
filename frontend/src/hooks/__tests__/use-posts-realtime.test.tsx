import {
  QueryClientProvider,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import { createQueryClient } from '@/app/query-client'
import { postKeys } from '@/lib/api/posts'
import type { Page, Post, Profile } from '@/lib/api/types'
import { profileQueryKey } from '@/lib/api/users'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'
import { FakeEventSource, installFakeEventSource } from '@/test/fake-event-source'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { useToggleLike } from '../use-posts'
import { usePostsRealtimeSync } from '../use-posts-realtime'

const post = (id: string, overrides: Partial<Post> = {}) => ({
  id,
  body: `post ${id}`,
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'grace' },
  likeCount: 1,
  commentCount: 0,
  likedByMe: true,
  ...overrides,
})

type TestPost = ReturnType<typeof post>

const list = <T,>(...items: T[]) => ({ pages: [{ items, nextCursor: null }], pageParams: [null] })

const listItems = (queryClient: QueryClient, queryKey: QueryKey) => {
  const data = queryClient.getQueryData<InfiniteData<Page<TestPost>>>(queryKey)
  if (!data) throw new Error(`No list cached under ${JSON.stringify(queryKey)}`)
  return data.pages.flatMap((page) => page.items)
}

// Mounts `usePostsRealtimeSync` (plus `useHooks`) inside the signed-in AuthProvider +
// RealtimeProvider and waits for the stream to open.
// `T` is inferred from `useHooks` when one is passed (the default renders nothing more).
async function renderSync<T = undefined>(
  seed: (queryClient: QueryClient) => void,
  useHooks: () => T = () => undefined as T,
) {
  const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })
  seed(queryClient)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeProvider>{children}</RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
  const utils = renderHook(
    () => {
      usePostsRealtimeSync()
      return useHooks()
    },
    { wrapper },
  )
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
  FakeEventSource.latest.open()
  return { queryClient, ...utils }
}

describe('usePostsRealtimeSync', () => {
  let uninstall: () => void

  beforeEach(() => {
    uninstall = installFakeEventSource()
  })

  afterEach(() => uninstall())

  describe('post.counts', () => {
    it('patches likeCount and commentCount in every list and the detail, never likedByMe', async () => {
      const { queryClient } = await renderSync((qc: QueryClient) => {
        qc.setQueryData(postKeys.feed(), list(post('p1'), post('p2')))
        qc.setQueryData(postKeys.forYou(), list(post('p1')))
        qc.setQueryData(postKeys.userPosts('grace'), list(post('p1')))
        qc.setQueryData(postKeys.detail('p1'), post('p1'))
      })

      FakeEventSource.latest.emit('post.counts', { id: 'p1', likeCount: 7, commentCount: 3 })

      for (const key of [postKeys.feed(), postKeys.forYou(), postKeys.userPosts('grace')]) {
        expect(listItems(queryClient, key)[0]).toEqual(
          post('p1', { likeCount: 7, commentCount: 3, likedByMe: true }),
        )
      }
      expect(queryClient.getQueryData(postKeys.detail('p1'))).toEqual(
        post('p1', { likeCount: 7, commentCount: 3, likedByMe: true }),
      )
      // Other posts are untouched.
      expect(listItems(queryClient, postKeys.feed())[1]).toEqual(post('p2'))
    })

    it('is skipped for a post with a like toggle in flight', async () => {
      let release: ((value?: unknown) => void) | undefined
      server.use(
        http.delete(apiUrl('/posts/:id/like'), async () => {
          await new Promise((resolve) => {
            release = resolve
          })
          return HttpResponse.json({ liked: false, likeCount: 4 })
        }),
      )
      const { queryClient, result } = await renderSync(
        (qc: QueryClient) => qc.setQueryData(postKeys.feed(), list(post('p1', { likeCount: 5 }))),
        () => useToggleLike(),
      )

      act(() => result.current.mutate({ postId: 'p1', liked: false }))
      await waitFor(() =>
        expect(listItems(queryClient, postKeys.feed())[0]).toMatchObject({
          likedByMe: false,
          likeCount: 4,
        }),
      )
      await waitFor(() => expect(release).toBeTypeOf('function'))

      FakeEventSource.latest.emit('post.counts', { id: 'p1', likeCount: 9, commentCount: 2 })
      // The optimistic state stays.
      expect(listItems(queryClient, postKeys.feed())[0]).toMatchObject({
        likedByMe: false,
        likeCount: 4,
        commentCount: 0,
      })

      await act(async () => release?.())
      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      // Once the toggle has settled, pushed counts apply again.
      await waitFor(() => {
        FakeEventSource.latest.emit('post.counts', { id: 'p1', likeCount: 6, commentCount: 2 })
        expect(listItems(queryClient, postKeys.feed())[0]).toMatchObject({
          likedByMe: false,
          likeCount: 6,
          commentCount: 2,
        })
      })
    })

    it('ignores a post that is not cached (no refetch)', async () => {
      const requests: string[] = []
      server.events.on('request:start', ({ request }) => requests.push(request.url))
      const feed = list(post('p1'))
      const { queryClient } = await renderSync((qc: QueryClient) => qc.setQueryData(postKeys.feed(), feed))
      requests.length = 0

      FakeEventSource.latest.emit('post.counts', { id: 'p9', likeCount: 7, commentCount: 3 })

      expect(queryClient.getQueryData(postKeys.feed())).toBe(feed)
      expect(queryClient.getQueryData(postKeys.detail('p9'))).toBeUndefined()
      expect(requests).toEqual([])
      server.events.removeAllListeners()
    })
  })

  describe('post.deleted', () => {
    it('drops the post from every list, removes its detail and comments, and decrements the author postCount', async () => {
      const { queryClient } = await renderSync((qc: QueryClient) => {
        qc.setQueryData(postKeys.feed(), list(post('p1'), post('p2')))
        qc.setQueryData(postKeys.forYou(), list(post('p1')))
        qc.setQueryData(postKeys.userPosts('grace'), list(post('p1')))
        qc.setQueryData(postKeys.detail('p1'), post('p1'))
        qc.setQueryData(postKeys.comments('p1'), list({ id: 'c1', body: 'hi' }))
        qc.setQueryData(profileQueryKey('grace'), { username: 'grace', postCount: 3 })
      })

      FakeEventSource.latest.emit('post.deleted', { id: 'p1' })

      await waitFor(() =>
        expect(listItems(queryClient, postKeys.feed()).map((p) => p.id)).toEqual(['p2']),
      )
      expect(listItems(queryClient, postKeys.forYou())).toEqual([])
      expect(listItems(queryClient, postKeys.userPosts('grace'))).toEqual([])
      expect(queryClient.getQueryData(postKeys.detail('p1'))).toBeUndefined()
      expect(queryClient.getQueryData(postKeys.comments('p1'))).toBeUndefined()
      expect(queryClient.getQueryData<Profile>(profileQueryKey('grace'))?.postCount).toBe(2)
    })

    it('ignores a post that is not cached', async () => {
      const feed = list(post('p1'))
      const profile = { username: 'grace', postCount: 3 }
      const { queryClient } = await renderSync((qc: QueryClient) => {
        qc.setQueryData(postKeys.feed(), feed)
        qc.setQueryData(profileQueryKey('grace'), profile)
      })

      FakeEventSource.latest.emit('post.deleted', { id: 'p9' })
      await act(async () => {})

      expect(queryClient.getQueryData(postKeys.feed())).toBe(feed)
      expect(queryClient.getQueryData(profileQueryKey('grace'))).toBe(profile)
    })
  })
})

describe('usePostsRealtimeSync in the app', () => {
  let uninstall: () => void

  beforeEach(() => {
    uninstall = installFakeEventSource()
  })

  afterEach(() => uninstall())

  async function openStream() {
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0))
    FakeEventSource.latest.open()
  }

  it('removes a deleted post from the rendered feed', async () => {
    const items = [
      post('p1', { body: 'soon deleted', likedByMe: false }),
      post('p2', { body: 'stays', likedByMe: false }),
    ]
    server.use(
      http.get(apiUrl('/feed'), () => HttpResponse.json({ items, nextCursor: null })),
    )
    renderWithProviders(<AppRouter />, { route: '/' })
    const feed = await screen.findByRole('tabpanel', { name: 'Following' })
    await within(feed).findByText('soon deleted')
    await openStream()

    FakeEventSource.latest.emit('post.deleted', { id: 'p1' })

    await waitFor(() => expect(within(feed).queryByText('soon deleted')).not.toBeInTheDocument())
    expect(within(feed).getByText('stays')).toBeInTheDocument()
  })

  it('updates the counts shown in the rendered feed', async () => {
    server.use(
      http.get(apiUrl('/feed'), () =>
        HttpResponse.json({
          items: [post('p1', { body: 'counted', likeCount: 1, likedByMe: false })],
          nextCursor: null,
        }),
      ),
    )
    renderWithProviders(<AppRouter />, { route: '/' })
    const feed = await screen.findByRole('tabpanel', { name: 'Following' })
    await within(feed).findByText('counted')
    await openStream()

    FakeEventSource.latest.emit('post.counts', { id: 'p1', likeCount: 12, commentCount: 5 })

    await waitFor(() => expect(within(feed).getByText('12')).toBeInTheDocument())
    expect(within(feed).getByText('5')).toBeInTheDocument()
  })

  it('shows the not-found state on the detail page of a deleted post', async () => {
    const state: { post: TestPost | null } = {
      post: post('p1', { body: 'about to go', likedByMe: false }),
    }
    const reply = {
      id: 'c1',
      body: 'a reply',
      createdAt: '2026-09-24T12:00:00.000Z',
      author: { username: 'ada' },
    }
    server.use(
      http.get(apiUrl('/posts/:id'), () =>
        state.post
          ? HttpResponse.json(state.post)
          : HttpResponse.json({ message: 'Post not found' }, { status: 404 }),
      ),
      http.get(apiUrl('/posts/:id/comments'), () =>
        state.post
          ? HttpResponse.json({ items: [reply], nextCursor: null })
          : HttpResponse.json({ message: 'Post not found' }, { status: 404 }),
      ),
    )
    const { queryClient } = renderWithProviders(<AppRouter />, { route: '/u/grace/posts/p1' })
    await screen.findByText('about to go')
    await screen.findByText('a reply')
    await openStream()

    state.post = null
    FakeEventSource.latest.emit('post.deleted', { id: 'p1' })

    expect(await screen.findByText('Post not found')).toBeInTheDocument()
    expect(screen.queryByText('about to go')).not.toBeInTheDocument()
    expect(screen.queryByText(/Couldn't load comments/)).not.toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryData(postKeys.comments('p1'))).toBeUndefined())
  })
})
