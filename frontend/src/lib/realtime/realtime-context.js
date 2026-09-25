import { createContext } from 'react'

// Stream status: 'connecting' (opening, or the browser is auto-retrying a transient drop),
// 'open', or 'closed' (no stream: signed out, EventSource unsupported, or waiting to reconnect).
export const REALTIME_STATUS = {
  connecting: 'connecting',
  open: 'open',
  closed: 'closed',
}

const noop = () => {}

// The subscribe API. Outside a RealtimeProvider (e.g. a page rendered alone in a test) every
// subscription is a no-op, so consumers never need to guard for it.
export const RealtimeApiContext = createContext({
  subscribe: () => noop,
  subscribeReconnect: () => noop,
})

// Split from the API so a status change re-renders only status readers.
export const RealtimeStatusContext = createContext(REALTIME_STATUS.closed)

// Backoff for reopening a stream the browser gave up on (CLOSED): 1s, 2s, 4s, ... capped at 30s,
// reset once a stream opens.
export const RECONNECT_BASE_DELAY = 1_000
export const RECONNECT_MAX_DELAY = 30_000

export const reconnectDelay = (attempt) =>
  Math.min(RECONNECT_BASE_DELAY * 2 ** attempt, RECONNECT_MAX_DELAY)
