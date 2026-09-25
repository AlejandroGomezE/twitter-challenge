import { act } from '@testing-library/react'

// A minimal stand-in for the browser's EventSource (jsdom has none), driven by the test:
// `installFakeEventSource()` puts `FakeEventSource` on `window` and returns an `uninstall()`
// function, which restores the previous `window.EventSource` (or removes it) and clears the
// recorded instances — call it after the test. Every instance is recorded in
// `FakeEventSource.instances` (`FakeEventSource.latest` is the newest). Drive a stream with
// `open()`, `emit(event, data)` (objects are JSON-encoded, strings sent raw), `drop()` (transient
// error, still CONNECTING) and `fail()` (error ending CLOSED, like a 401). Each runs inside `act`.
export class FakeEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances = []

  constructor(url, init = {}) {
    this.url = url
    this.withCredentials = Boolean(init.withCredentials)
    this.readyState = FakeEventSource.CONNECTING
    this.onopen = null
    this.onerror = null
    this.listeners = new Map()
    FakeEventSource.instances.push(this)
  }

  static get latest() {
    return FakeEventSource.instances.at(-1)
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
  }

  dispatch(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  open() {
    act(() => {
      this.readyState = FakeEventSource.OPEN
      this.onopen?.({ type: 'open' })
      this.dispatch('open', { type: 'open' })
    })
  }

  emit(type, data) {
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
  const previous = window.EventSource
  FakeEventSource.instances = []
  window.EventSource = FakeEventSource
  return function uninstall() {
    if (previous === undefined) delete window.EventSource
    else window.EventSource = previous
    FakeEventSource.instances = []
  }
}
