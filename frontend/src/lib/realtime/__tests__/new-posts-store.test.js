import { InfiniteQueryObserver } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import { fetchFeed, fetchForYouFeed, postKeys } from '@/lib/api/posts'
import { apiUrl, server } from '@/test/server'
import {
  NEW_POSTS_TABS,
  createNewPostsStore,
  feedQueryKey,
  syncNewPostsWithFeeds,
} from '../new-posts-store'

const { following: FOLLOWING, forYou: FOR_YOU } = NEW_POSTS_TABS

const newClient = () => createQueryClient({ queries: { retry: false, gcTime: Infinity } })

// A feed page holding posts with the given ids.
const page = (ids, nextCursor = null) => ({ items: ids.map((id) => ({ id })), nextCursor })
// Infinite-query data with one page per ids array.
const feedData = (...pages) => ({ pages: pages.map((ids) => page(ids)), pageParams: pages.map(() => null) })

// The same infinite-query options Home's feeds use (hooks/use-posts.js).
const feedOptions = (tab) => ({
  queryKey: feedQueryKey(tab),
  queryFn: ({ pageParam }) => (tab === FOR_YOU ? fetchForYouFeed : fetchFeed)(pageParam),
  initialPageParam: null,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
})

// A promise the test resolves when it wants a held MSW response to land.
function gate() {
  let open
  const promise = new Promise((resolve) => {
    open = resolve
  })
  return { promise, open }
}

// `GET /feed` answering `body` only once `g` is opened.
const gatedFeed = (g, body) =>
  server.use(
    http.get(apiUrl('/feed'), async () => {
      await g.promise
      return HttpResponse.json(body)
    }),
  )

describe('feedQueryKey', () => {
  it('maps each Home tab to its feed query', () => {
    expect(feedQueryKey(FOLLOWING)).toEqual(postKeys.feed())
    expect(feedQueryKey(FOR_YOU)).toEqual(postKeys.forYou())
  })
})

describe('createNewPostsStore', () => {
  it('adds a post.created to For you always, and to Following only when following', () => {
    const store = createNewPostsStore()

    store.add('a', false)
    expect(store.getIds(FOR_YOU)).toEqual(['a'])
    expect(store.getIds(FOLLOWING)).toEqual([])

    store.add('b', true)
    expect(store.getIds(FOR_YOU)).toEqual(['a', 'b'])
    expect(store.getIds(FOLLOWING)).toEqual(['b'])
  })

  it('ignores duplicates without notifying or changing the snapshot', () => {
    const store = createNewPostsStore()
    store.add('a', true)
    const forYou = store.getIds(FOR_YOU)
    const following = store.getIds(FOLLOWING)
    const listener = vi.fn()
    store.subscribe(listener)

    store.add('a', true)
    store.add('a', false)

    expect(store.getIds(FOR_YOU)).toBe(forYou)
    expect(store.getIds(FOLLOWING)).toBe(following)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps each tab snapshot stable until that tab changes, and notifies subscribers', () => {
    const store = createNewPostsStore()
    const following = store.getIds(FOLLOWING)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.add('a', false) // For you only
    expect(store.getIds(FOLLOWING)).toBe(following)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.add('b', false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('removes a post.deleted from both tabs', () => {
    const store = createNewPostsStore()
    store.add('a', true)
    store.add('b', true)

    store.remove('a')

    expect(store.getIds(FOLLOWING)).toEqual(['b'])
    expect(store.getIds(FOR_YOU)).toEqual(['b'])
  })

  it('treats removing an unknown id as a no-op', () => {
    const store = createNewPostsStore()
    store.add('a', true)
    const forYou = store.getIds(FOR_YOU)
    const following = store.getIds(FOLLOWING)
    const listener = vi.fn()
    store.subscribe(listener)

    store.remove('nope')

    expect(store.getIds(FOR_YOU)).toBe(forYou)
    expect(store.getIds(FOLLOWING)).toBe(following)
    expect(listener).not.toHaveBeenCalled()
  })

  it('removeFromTab and clear only touch the given tab', () => {
    const store = createNewPostsStore()
    store.add('a', true)
    store.add('b', true)

    store.removeFromTab(FOLLOWING, ['a'])
    expect(store.getIds(FOLLOWING)).toEqual(['b'])
    expect(store.getIds(FOR_YOU)).toEqual(['a', 'b'])

    store.clear(FOR_YOU)
    expect(store.getIds(FOR_YOU)).toEqual([])
    expect(store.getIds(FOLLOWING)).toEqual(['b'])
  })
})

describe('syncNewPostsWithFeeds', () => {
  const cleanups = []
  const setup = () => {
    const queryClient = newClient()
    const store = createNewPostsStore()
    const unsubscribe = syncNewPostsWithFeeds(queryClient, store)
    cleanups.push(unsubscribe, () => queryClient.clear())
    return { queryClient, store, unsubscribe }
  }

  afterEach(() => {
    while (cleanups.length) cleanups.pop()()
  })

  it('drops pending ids that show up in that feed’s cached data, and only for that tab', () => {
    const { queryClient, store } = setup()
    store.add('a', true)
    store.add('b', true)

    queryClient.setQueryData(postKeys.feed(), feedData(['x', 'a']))

    expect(store.getIds(FOLLOWING)).toEqual(['b'])
    expect(store.getIds(FOR_YOU)).toEqual(['a', 'b'])
  })

  it('ignores post lists that are not a Home feed', () => {
    const { queryClient, store } = setup()
    store.add('a', true)

    queryClient.setQueryData(postKeys.userPosts('ada'), feedData(['a']))

    expect(store.getIds(FOLLOWING)).toEqual(['a'])
    expect(store.getIds(FOR_YOU)).toEqual(['a'])
  })

  it('a first-page fetch drops the ids pending when it started, but keeps ids that arrived during it', async () => {
    const { queryClient, store } = setup()
    store.add('before', true)
    const g = gate()
    gatedFeed(g, page(['during-shown', 'older']))

    const done = queryClient.fetchInfiniteQuery(feedOptions(FOLLOWING))
    store.add('during', true)
    store.add('during-shown', true)
    expect(store.getIds(FOLLOWING)).toEqual(['before', 'during', 'during-shown'])

    g.open()
    await done

    // 'before' existed before the fetch; 'during-shown' is in its result; 'during' may not be.
    expect(store.getIds(FOLLOWING)).toEqual(['during'])
    // The other tab's feed wasn't fetched.
    expect(store.getIds(FOR_YOU)).toEqual(['before', 'during', 'during-shown'])
  })

  it('a failed first-page fetch keeps the pending ids', async () => {
    const { queryClient, store } = setup()
    store.add('a', true)
    server.use(
      http.get(apiUrl('/feed'), () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    )

    await expect(queryClient.fetchInfiniteQuery(feedOptions(FOLLOWING))).rejects.toThrow()

    expect(store.getIds(FOLLOWING)).toEqual(['a'])
  })

  it('a "load more" (fetchNextPage) does not clear pending ids', async () => {
    const { queryClient, store } = setup()
    server.use(
      http.get(apiUrl('/feed'), ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'c1'
          ? HttpResponse.json(page(['p2']))
          : HttpResponse.json(page(['p1'], 'c1'))),
    )
    const observer = new InfiniteQueryObserver(queryClient, feedOptions(FOLLOWING))
    cleanups.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))

    store.add('new', true)
    await observer.fetchNextPage()

    expect(queryClient.getQueryData(postKeys.feed()).pages).toHaveLength(2)
    expect(store.getIds(FOLLOWING)).toEqual(['new'])
  })

  it('a manual cache write (e.g. an optimistic prepend) does not count as a refetch', () => {
    const { queryClient, store } = setup()
    queryClient.setQueryData(postKeys.feed(), feedData(['old']))
    store.add('a', true)

    queryClient.setQueryData(postKeys.feed(), (data) => ({
      ...data,
      pages: [{ ...data.pages[0], items: [{ id: 'mine' }, ...data.pages[0].items] }],
    }))

    expect(store.getIds(FOLLOWING)).toEqual(['a'])
  })

  it('a manual cache write during a first-page fetch leaves that fetch to clear its ids', async () => {
    const { queryClient, store } = setup()
    store.add('a', true)
    const g = gate()
    gatedFeed(g, page(['older']))

    const done = queryClient.fetchInfiniteQuery(feedOptions(FOLLOWING))
    queryClient.setQueryData(postKeys.feed(), feedData(['mine']))
    expect(store.getIds(FOLLOWING)).toEqual(['a'])

    g.open()
    await done

    expect(store.getIds(FOLLOWING)).toEqual([])
  })

  it('stops syncing once unsubscribed', () => {
    const { queryClient, store, unsubscribe } = setup()
    store.add('a', true)

    unsubscribe()
    queryClient.setQueryData(postKeys.feed(), feedData(['a']))

    expect(store.getIds(FOLLOWING)).toEqual(['a'])
  })
})
