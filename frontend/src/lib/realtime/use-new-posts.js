import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useContext, useSyncExternalStore } from 'react'
import { NewPostsContext, feedQueryKey } from './new-posts-store'

const EMPTY = []
const noopSubscribe = () => () => {}
const emptySnapshot = () => EMPTY

// `{ count, clear }` for a Home feed tab ('following' | 'for-you'): how many new posts are waiting
// behind its pill, and a way to forget them. Outside a NewPostsProvider the count is always 0.
export function useNewPosts(tab) {
  const store = useContext(NewPostsContext)
  const ids = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? () => store.getIds(tab) : emptySnapshot,
  )
  const clear = useCallback(() => store?.clear(tab), [store, tab])

  return { count: ids.length, clear }
}

// Keeps only the first page of an infinite query's data (and its page param).
const keepFirstPage = (data) =>
  data && data.pages.length > 1
    ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
    : data

// Returns `show()`, the pill's action for `tab`: clears its pending ids and reloads that feed from
// the first page, so the new posts land at the top. Later pages are dropped first — a refetch
// would otherwise re-request every loaded page — and "load more" brings them back. In-flight
// fetches of the feed are cancelled first, so a "load more" can't append to the fresh page.
// Resolves once the refetch settles (it never rejects; a failure shows in the feed's state).
export function useShowNewPosts(tab) {
  const queryClient = useQueryClient()
  const { clear } = useNewPosts(tab)

  return useCallback(async () => {
    clear()
    const queryKey = feedQueryKey(tab)
    const filters = { queryKey, exact: true }
    await queryClient.cancelQueries(filters)
    queryClient.setQueryData(queryKey, keepFirstPage)
    await queryClient.refetchQueries(filters)
  }, [clear, queryClient, tab])
}
