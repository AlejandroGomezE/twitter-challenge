import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router'
import { AUTH_ME_QUERY_KEY } from '@/lib/auth/auth-context'
import { renderWithProviders } from '@/test/render'
import { FakeEventSource, installFakeEventSource } from '@/test/fake-event-source'
import { apiUrl, server } from '@/test/server'
import { RealtimeProvider } from '../RealtimeProvider'
import { RECONNECT_MAX_DELAY, reconnectDelay } from '../realtime-context'
import { useRealtimeEvent, useRealtimeReconnect, useRealtimeStatus } from '../use-realtime'

const signedOut = () =>
  server.use(
    http.get(apiUrl('/auth/me'), () =>
      HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
    ),
  )

function Status() {
  return <output data-testid="status">{useRealtimeStatus()}</output>
}

function Subscriber({ eventName, onEvent }) {
  useRealtimeEvent(eventName, onEvent)
  return null
}

function ReconnectSubscriber({ onReconnect }) {
  useRealtimeReconnect(onReconnect)
  return null
}

// RealtimeProvider on its own (signed in by default), plus a status readout.
async function renderProvider(children = null) {
  const utils = renderWithProviders(
    <RealtimeProvider>
      <Status />
      {children}
    </RealtimeProvider>,
  )
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
  return utils
}

const status = () => screen.getByTestId('status')

describe('RealtimeProvider without EventSource', () => {
  it('renders its children, stays closed and delivers nothing', async () => {
    expect(window.EventSource).toBeUndefined()
    const onEvent = vi.fn()

    renderWithProviders(
      <RealtimeProvider>
        <Status />
        <Subscriber eventName="post.created" onEvent={onEvent} />
      </RealtimeProvider>,
    )

    expect(status()).toHaveTextContent('closed')
  })

  it('reports closed and no-ops subscriptions outside a provider', () => {
    const onEvent = vi.fn()
    renderWithProviders(
      <>
        <Status />
        <Subscriber eventName="post.created" onEvent={onEvent} />
      </>,
    )
    expect(status()).toHaveTextContent('closed')
  })
})

describe('RealtimeProvider', () => {
  let uninstall
  beforeEach(() => {
    uninstall = installFakeEventSource()
  })
  afterEach(() => {
    vi.useRealTimers()
    uninstall()
  })

  describe('in the app', () => {
    it('opens one stream with credentials once the signed-in shell renders', async () => {
      renderWithProviders(<AppRouter />, { route: '/' })
      await screen.findByRole('banner')

      expect(FakeEventSource.instances).toHaveLength(1)
      expect(FakeEventSource.latest.url).toBe(apiUrl('/events'))
      expect(FakeEventSource.latest.withCredentials).toBe(true)
    })

    it.each([
      ['/sign-in', 'Sign in'],
      ['/sign-up', 'Create an account'],
    ])('opens no stream on %s', async (route, heading) => {
      signedOut()
      renderWithProviders(<AppRouter />, { route })

      await screen.findByRole('heading', { name: heading })
      expect(FakeEventSource.instances).toHaveLength(0)
    })
  })

  it('reports connecting, then open', async () => {
    await renderProvider()
    expect(status()).toHaveTextContent('connecting')

    FakeEventSource.latest.open()

    expect(status()).toHaveTextContent('open')
  })

  it('delivers parsed JSON to subscribers of that event name only', async () => {
    const onCreated = vi.fn()
    const onDeleted = vi.fn()
    await renderProvider(
      <>
        <Subscriber eventName="post.created" onEvent={onCreated} />
        <Subscriber eventName="post.deleted" onEvent={onDeleted} />
      </>,
    )
    const source = FakeEventSource.latest
    source.open()

    source.emit('post.created', { id: 'p1', following: true })

    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith({ id: 'p1', following: true })
    expect(onDeleted).not.toHaveBeenCalled()

    source.emit('post.deleted', { id: 'p1' })
    expect(onDeleted).toHaveBeenCalledWith({ id: 'p1' })
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('ignores messages with malformed JSON', async () => {
    const onEvent = vi.fn()
    await renderProvider(<Subscriber eventName="post.counts" onEvent={onEvent} />)
    const source = FakeEventSource.latest
    source.open()

    expect(() => source.emit('post.counts', '{not json')).not.toThrow()
    expect(onEvent).not.toHaveBeenCalled()

    source.emit('post.counts', { id: 'p1', likeCount: 2, commentCount: 0 })
    expect(onEvent).toHaveBeenCalledWith({ id: 'p1', likeCount: 2, commentCount: 0 })
  })

  it('uses the latest handler and stops delivering after unmount', async () => {
    const first = vi.fn()
    const second = vi.fn()
    function Harness() {
      const [handler, setHandler] = useState(() => first)
      const [mounted, setMounted] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setHandler(() => second)}>
            Swap handler
          </button>
          <button type="button" onClick={() => setMounted(false)}>
            Unmount
          </button>
          {mounted && <Subscriber eventName="post.created" onEvent={handler} />}
        </>
      )
    }
    await renderProvider(<Harness />)
    const source = FakeEventSource.latest
    source.open()

    fireEvent.click(screen.getByRole('button', { name: 'Swap handler' }))
    source.emit('post.created', { id: 'p1', following: false })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Unmount' }))
    source.emit('post.created', { id: 'p2', following: false })
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('keeps the stream on a transient drop (the browser retries it)', async () => {
    await renderProvider()
    const source = FakeEventSource.latest
    source.open()

    source.drop()

    expect(status()).toHaveTextContent('connecting')
    expect(FakeEventSource.instances).toHaveLength(1)
    source.open()
    expect(status()).toHaveTextContent('open')
  })

  it('reopens a CLOSED stream with capped exponential backoff and runs the reconnect callback', async () => {
    const onReconnect = vi.fn()
    const onEvent = vi.fn()
    await renderProvider(
      <>
        <ReconnectSubscriber onReconnect={onReconnect} />
        <Subscriber eventName="post.created" onEvent={onEvent} />
      </>,
    )
    FakeEventSource.latest.open()
    expect(onReconnect).not.toHaveBeenCalled() // the first open isn't a reconnect
    vi.useFakeTimers()

    FakeEventSource.latest.fail()
    expect(status()).toHaveTextContent('closed')
    act(() => vi.advanceTimersByTime(999))
    expect(FakeEventSource.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(status()).toHaveTextContent('connecting')

    // Failing again before opening doubles the wait.
    FakeEventSource.latest.fail()
    act(() => vi.advanceTimersByTime(1_999))
    expect(FakeEventSource.instances).toHaveLength(2)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeEventSource.instances).toHaveLength(3)
    expect(FakeEventSource.instances[0].readyState).toBe(FakeEventSource.CLOSED)
    expect(FakeEventSource.latest.withCredentials).toBe(true)

    FakeEventSource.latest.open()
    expect(status()).toHaveTextContent('open')
    expect(onReconnect).toHaveBeenCalledTimes(1)

    // Subscriptions carry over to the new stream.
    FakeEventSource.latest.emit('post.created', { id: 'p1', following: true })
    expect(onEvent).toHaveBeenCalledWith({ id: 'p1', following: true })

    // An open resets the backoff.
    FakeEventSource.latest.fail()
    act(() => vi.advanceTimersByTime(1_000))
    expect(FakeEventSource.instances).toHaveLength(4)
  })

  it('caps the backoff at 30s', () => {
    expect(reconnectDelay(0)).toBe(1_000)
    expect(reconnectDelay(3)).toBe(8_000)
    expect(reconnectDelay(10)).toBe(RECONNECT_MAX_DELAY)
    expect(RECONNECT_MAX_DELAY).toBe(30_000)
  })

  it('closes the stream and stops reconnecting once signed out', async () => {
    const { queryClient } = await renderProvider()
    const source = FakeEventSource.latest
    source.open()
    vi.useFakeTimers()
    source.fail()

    // Query notifications are batched on a 0ms timer: flush them so the sign-out commits first.
    act(() => {
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, null)
      vi.advanceTimersByTime(0)
    })
    act(() => vi.advanceTimersByTime(RECONNECT_MAX_DELAY))

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(status()).toHaveTextContent('closed')
  })

  it('closes an open stream on sign-out', async () => {
    const { queryClient } = await renderProvider()
    const source = FakeEventSource.latest
    source.open()

    act(() => queryClient.setQueryData(AUTH_ME_QUERY_KEY, null))

    await waitFor(() => expect(source.readyState).toBe(FakeEventSource.CLOSED))
    expect(status()).toHaveTextContent('closed')
  })
})
