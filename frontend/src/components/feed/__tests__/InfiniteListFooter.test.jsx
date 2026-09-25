import { useInfiniteQuery } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api/client'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { InfiniteListFooter } from '../InfiniteListFooter'

// A minimal cursor-paged list over `GET /things`, rendering the footer the way pages do.
function ThingList() {
  const query = useInfiniteQuery({
    queryKey: ['things'],
    queryFn: ({ pageParam }) =>
      apiClient.get(pageParam ? `/things?cursor=${pageParam}` : '/things'),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
  if (query.isPending) return <p>Loading</p>
  return (
    <>
      <ul>
        {query.data.pages.flatMap((page) => page.items).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <InfiniteListFooter query={query} endMessage="You're all caught up" />
    </>
  )
}

// Page 1 → `first` (+ cursor c1); page 2 → `second` (end), optionally held until `gate` resolves.
// Returns the number of page-2 requests seen so far.
function mockThings({ gate } = {}) {
  const calls = { second: 0 }
  server.use(
    http.get(apiUrl('/things'), async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      if (!cursor) return HttpResponse.json({ items: ['first'], nextCursor: 'c1' })
      calls.second += 1
      if (gate) await gate
      return HttpResponse.json({ items: ['second'], nextCursor: null })
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('InfiniteListFooter', () => {
  it('loads the next page through the "Load more" button, then shows the end message', async () => {
    const calls = mockThings()
    const { user } = renderWithProviders(<ThingList />)

    await user.click(await screen.findByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('second')).toBeInTheDocument()
    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(calls.second).toBe(1)
  })

  it('does not double-fetch when the sentinel and the button both ask for the next page', async () => {
    // The sentinel is "in view" as soon as it's observed.
    class InViewObserver {
      constructor(callback) {
        this.callback = callback
      }
      observe() {
        this.callback([{ isIntersecting: true }])
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', InViewObserver)
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const calls = mockThings({ gate })
    const { user } = renderWithProviders(<ThingList />)

    // The observer already started page 2: the button shows it's loading and ignores clicks.
    const button = await screen.findByRole('button', { name: 'Loading…' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    await user.click(button)

    release()
    expect(await screen.findByText('second')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText("You're all caught up")).toBeInTheDocument())
    expect(calls.second).toBe(1)
  })

  it('still loads the next page when the sentinel fires during a refetch of the list', async () => {
    // A controllable observer: `scrollIntoView()` puts the sentinel in view and notifies the live
    // observers; an observer created while it's in view fires on `observe` (like the real one).
    const live = new Set()
    let inView = false
    class ControlledObserver {
      constructor(callback) {
        this.callback = callback
      }
      observe() {
        live.add(this)
        if (inView) this.callback([{ isIntersecting: true }])
      }
      unobserve() {
        live.delete(this)
      }
      disconnect() {
        live.delete(this)
      }
    }
    const scrollIntoView = () => {
      inView = true
      for (const observer of [...live]) observer.callback([{ isIntersecting: true }])
    }
    vi.stubGlobal('IntersectionObserver', ControlledObserver)

    // First-page requests after the first one (the refetch) wait for `refetchGate`.
    let releaseRefetch
    const refetchGate = new Promise((resolve) => {
      releaseRefetch = resolve
    })
    let firstPageCalls = 0
    let secondPageCalls = 0
    server.use(
      http.get(apiUrl('/things'), async ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor')) {
          secondPageCalls += 1
          return HttpResponse.json({ items: ['second'], nextCursor: null })
        }
        firstPageCalls += 1
        if (firstPageCalls > 1) await refetchGate
        return HttpResponse.json({ items: ['first'], nextCursor: 'c1' })
      }),
    )
    const { queryClient } = renderWithProviders(<ThingList />)
    await screen.findByRole('button', { name: 'Load more' })
    expect(live.size).toBe(1)

    // A background refetch starts (window focus, a restart after a write) and the sentinel comes
    // into view before React re-renders: the observer's fetchNextPage joins the refetch.
    act(() => {
      queryClient.refetchQueries({ queryKey: ['things'] })
      scrollIntoView()
    })
    expect(secondPageCalls).toBe(0)

    // Released right away, so React may never render the refetch as in flight. Once it ends, the
    // sentinel (still in view) is checked again and page 2 loads — once.
    await act(async () => releaseRefetch())
    expect(await screen.findByText('second')).toBeInTheDocument()
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(secondPageCalls).toBe(1)
    expect(firstPageCalls).toBe(2)
  })
})
