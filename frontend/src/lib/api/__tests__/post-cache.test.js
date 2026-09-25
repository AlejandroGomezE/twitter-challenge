import { QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/app/query-client'
import { cancelLoadedFetches, writeAfterServerChange } from '../post-cache'

const KEY = ['posts', 'list', 'feed']
const FILTERS = [{ queryKey: KEY, exact: true }]

const newClient = () => createQueryClient({ queries: { retry: false, gcTime: Infinity } })

// A queryFn whose call i waits until the test calls `open(i)`, then answers `answers[i]`.
function gatedQueryFn(answers) {
  const gates = []
  const queryFn = () =>
    new Promise((resolve) => {
      const i = gates.length
      gates.push(() => resolve(answers[i]))
    })
  return { queryFn, calls: () => gates.length, open: (i) => gates[i]() }
}

// A first load the way a mounted list starts it: an observer subscribed to a query with no data.
// (TanStack skips refetching an unobserved query that never loaded, so the observer matters.)
const observe = (queryClient, queryFn) =>
  new QueryObserver(queryClient, { queryKey: KEY, queryFn }).subscribe(() => {})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('writeAfterServerChange', () => {
  it('restarts a first load it cancelled, so it ends with the post-write server state', async () => {
    const queryClient = newClient()
    const fetcher = gatedQueryFn(['stale', 'fresh'])
    const unsubscribe = observe(queryClient, fetcher.queryFn)
    await flush()
    expect(fetcher.calls()).toBe(1)

    let wrote = false
    await writeAfterServerChange(queryClient, FILTERS, () => {
      wrote = true
    })
    expect(wrote).toBe(true)
    await flush()
    expect(fetcher.calls()).toBe(2)

    fetcher.open(0) // the cancelled request answering late is ignored
    fetcher.open(1)
    await flush()
    expect(queryClient.getQueryData(KEY)).toBe('fresh')
    expect(queryClient.getQueryState(KEY).fetchStatus).toBe('idle')
    unsubscribe()
  })

  it('cancels a refetch of loaded data without restarting it', async () => {
    const queryClient = newClient()
    queryClient.setQueryData(KEY, 'loaded')
    const fetcher = gatedQueryFn(['stale'])
    queryClient.fetchQuery({ queryKey: KEY, queryFn: fetcher.queryFn, staleTime: 0 }).catch(() => {})
    await flush()

    await writeAfterServerChange(queryClient, FILTERS, () => queryClient.setQueryData(KEY, 'written'))
    fetcher.open(0)
    await flush()
    expect(fetcher.calls()).toBe(1)
    expect(queryClient.getQueryData(KEY)).toBe('written')
  })
})

describe('cancelLoadedFetches', () => {
  it('leaves a first load running', async () => {
    const queryClient = newClient()
    const fetcher = gatedQueryFn(['first'])
    const unsubscribe = observe(queryClient, fetcher.queryFn)
    await flush()

    await cancelLoadedFetches(queryClient, FILTERS)
    fetcher.open(0)
    await flush()
    expect(fetcher.calls()).toBe(1)
    expect(queryClient.getQueryData(KEY)).toBe('first')
    unsubscribe()
  })
})
