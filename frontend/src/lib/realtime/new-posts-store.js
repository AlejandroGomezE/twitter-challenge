import { createContext } from 'react'
import { matchQuery } from '@tanstack/react-query'
import { postKeys } from '@/lib/api/posts'

// Home's feed tabs, by the same ids Home uses for them (`?tab=for-you`; Following is the default).
export const NEW_POSTS_TABS = {
  following: 'following',
  forYou: 'for-you',
}

// The feed query behind each tab.
export const feedQueryKey = (tab) =>
  tab === NEW_POSTS_TABS.forYou ? postKeys.forYou() : postKeys.feed()

const TAB_IDS = Object.values(NEW_POSTS_TABS)
const EMPTY = Object.freeze([])

// The pending ("N new posts") post ids per feed tab, as an external store for
// `useSyncExternalStore`: `getIds(tab)` returns the same array until that tab changes.
//   add(id, following) — a `post.created` from someone else: For you always gets it, Following
//                        only when the recipient follows the author. Duplicates are ignored.
//   remove(id)         — a `post.deleted`: dropped from every tab.
//   removeFromTab(tab, ids) — ids that tab's feed now shows (or was refetched after).
//   clear(tab)         — the pill was clicked.
export function createNewPostsStore() {
  let state = Object.fromEntries(TAB_IDS.map((tab) => [tab, EMPTY]))
  const listeners = new Set()

  const setTab = (tab, ids) => {
    if (ids === state[tab]) return
    state = { ...state, [tab]: ids }
    for (const listener of [...listeners]) listener()
  }

  const without = (ids, drop) => {
    if (ids.length === 0) return ids
    const next = ids.filter((id) => !drop.has(id))
    return next.length === ids.length ? ids : next
  }

  return {
    getIds: (tab) => state[tab] ?? EMPTY,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    add(id, following) {
      const tabs = following ? TAB_IDS : [NEW_POSTS_TABS.forYou]
      for (const tab of tabs) {
        if (!state[tab].includes(id)) setTab(tab, [...state[tab], id])
      }
    },
    remove(id) {
      for (const tab of TAB_IDS) setTab(tab, without(state[tab], new Set([id])))
    },
    removeFromTab(tab, ids) {
      if (state[tab] === undefined) return
      setTab(tab, without(state[tab], new Set(ids)))
    },
    clear(tab) {
      if (state[tab] !== undefined) setTab(tab, EMPTY)
    },
  }
}

// The provider's store; `null` outside a NewPostsProvider (e.g. a page rendered alone in a test).
export const NewPostsContext = createContext(null)

const tabOfQuery = (query) =>
  TAB_IDS.find((tab) => matchQuery({ queryKey: feedQueryKey(tab), exact: true }, query))

const idsInFeed = (data) => data?.pages?.flatMap((page) => page.items.map((post) => post.id)) ?? []

// Keeps the pending ids in step with the feed caches, so a pill never counts posts the list
// already shows:
// - whenever a feed's data changes (a fetch or a cache write), ids now in it are dropped;
// - a fetch from the first page (any fetch but "load more": the first load, a refetch on mount or
//   focus, Retry, the pill itself) drops, once it succeeds, every id that was pending when it
//   started — those posts existed before it, so they're in its result (unless deleted since).
//   Ids that arrive while it's in flight stay pending, in case it read the feed before them.
// Returns the unsubscribe.
export function syncNewPostsWithFeeds(queryClient, store) {
  // tab -> ids pending when its current first-page fetch started.
  const inFlight = new Map()

  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return
    const tab = tabOfQuery(event.query)
    if (!tab) return
    const { action, query } = event

    switch (action.type) {
      case 'fetch':
        if (action.meta?.fetchMore) inFlight.delete(tab)
        else inFlight.set(tab, store.getIds(tab))
        break
      case 'success': {
        const ids = idsInFeed(query.state.data)
        if (!action.manual && inFlight.has(tab)) {
          ids.push(...inFlight.get(tab))
          inFlight.delete(tab)
        }
        store.removeFromTab(tab, ids)
        break
      }
      case 'error':
        inFlight.delete(tab)
        break
      case 'setState':
        // A cancelled fetch reverts to its previous state.
        if (query.state.fetchStatus === 'idle') inFlight.delete(tab)
        break
      default:
    }
  })
}
