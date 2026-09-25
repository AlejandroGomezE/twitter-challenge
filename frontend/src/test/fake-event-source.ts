import { act } from '@testing-library/react'
import type { RealtimeEventMap, RealtimeEventName } from '@/lib/api/types'

// A minimal stand-in for the browser's EventSource (jsdom has none), driven by the test:
// `installFakeEventSource()` puts `FakeEventSource` on `window` and returns an `uninstall()`
// function, which restores the previous `window.EventSource` (or removes it) and clears the
// recorded instances — call it after the test. Every instance is recorded in
// `FakeEventSource.instances` (`FakeEventSource.latest` is the newest). Drive a stream with
// `open()`, `emit(event, data)` (objects are JSON-encoded, strings sent raw), `drop()` (transient
// error, still CONNECTING) and `fail()` (error ending CLOSED, like a 401). Each runs inside `act`.
// What the fake hands its listeners: the subset of `Event` / `MessageEvent` the app reads.
export interface FakeEvent {
  type: string
  data?: string
}

export type FakeEventListener = (event: FakeEvent) => void

export class FakeEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances: FakeEventSource[] = []

  url: string
  withCredentials: boolean
  readyState: number
  onopen: FakeEventListener | null
  onerror: FakeEventListener | null
  listeners: Map<string, Set<FakeEventListener>>

  constructor(url: string, init: EventSourceInit = {}) {
    this.url = url
    this.withCredentials = Boolean(init.withCredentials)
    this.readyState = FakeEventSource.CONNECTING
    this.onopen = null
    this.onerror = null
    this.listeners = new Map()
    FakeEventSource.instances.push(this)
  }

  static get latest(): FakeEventSource {
    const latest = FakeEventSource.instances.at(-1)
    if (!latest) throw new Error('No FakeEventSource has been created yet')
    return latest
  }

  addEventListener(type: string, listener: FakeEventListener) {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: FakeEventListener) {
    this.listeners.get(type)?.delete(listener)
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
  }

  dispatch(type: string, event: FakeEvent) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  open() {
    act(() => {
      this.readyState = FakeEventSource.OPEN
      this.onopen?.({ type: 'open' })
      this.dispatch('open', { type: 'open' })
    })
  }

  // `data` is JSON-encoded unless it's a string (sent raw, e.g. to test malformed JSON).
  emit<E extends RealtimeEventName>(type: E, data: RealtimeEventMap[E] | string) {
    act(() => {
      const body = typeof data === 'string' ? data : JSON.stringify(data)
      this.dispatch(type, { type, data: body })
    })
  }

  drop() {
    act(() => {
      this.readyState = FakeEventSource.CONNECTING
      this.onerror?.({ type: 'error' })
    })
  }

  fail() {
    act(() => {
      this.readyState = FakeEventSource.CLOSED
      this.onerror?.({ type: 'error' })
    })
  }
}

export function installFakeEventSource() {
  // jsdom has no EventSource, so the global may be missing at runtime despite lib.dom's typing.
  const globals = window as { EventSource?: typeof EventSource }
  const previous = globals.EventSource
  FakeEventSource.instances = []
  // The fake implements only the part of EventSource the app uses.
  window.EventSource = FakeEventSource as unknown as typeof EventSource
  return function uninstall() {
    if (previous === undefined) delete globals.EventSource
    else window.EventSource = previous
    FakeEventSource.instances = []
  }
}
