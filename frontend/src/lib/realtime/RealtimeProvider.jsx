import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_URL } from '@/lib/api/client'
import { useAuth } from '@/lib/auth/use-auth'
import {
  REALTIME_STATUS,
  RealtimeApiContext,
  RealtimeStatusContext,
  reconnectDelay,
} from './realtime-context'

// EventSource.CLOSED, for fakes that don't define the static.
const CLOSED = 2

const getEventSource = () =>
  typeof window !== 'undefined' && typeof window.EventSource === 'function'
    ? window.EventSource
    : null

// Adds (or removes) `handler` to the Set stored under `key` in `map`; returns the unsubscribe.
function addToMap(map, key, handler) {
  let handlers = map.get(key)
  if (!handlers) {
    handlers = new Set()
    map.set(key, handlers)
  }
  handlers.add(handler)
  return () => handlers.delete(handler)
}

// Opens ONE `GET /events` stream (Server-Sent Events, session cookie via `withCredentials`) while
// the user is signed in, and fans its typed messages out to `useRealtimeEvent` subscribers.
// Transient drops are retried by the browser itself; when the stream ends CLOSED (e.g. a 401, or
// the server is gone) it is reopened with capped exponential backoff, still only while signed in.
// Every open after the first notifies `useRealtimeReconnect` subscribers. Without
// `window.EventSource` (jsdom) it renders its children and does nothing else.
export function RealtimeProvider({ children }) {
  const { isAuthenticated } = useAuth()
  // The stream's own state, only written from its callbacks; reported as 'closed' whenever no
  // stream is wanted (signed out) or possible (no EventSource).
  const [streamStatus, setStatus] = useState(REALTIME_STATUS.connecting)
  const status =
    isAuthenticated && getEventSource() ? streamStatus : REALTIME_STATUS.closed

  // eventName -> Set<handler(data)>, and the Set of reconnect handlers.
  const eventHandlersRef = useRef(new Map())
  const reconnectHandlersRef = useRef(new Set())
  // The live EventSource and the event names already bound on it.
  const sourceRef = useRef(null)
  const boundNamesRef = useRef(new Set())

  // One native listener per event name, bound lazily (the first time someone subscribes to it).
  const bind = useCallback((eventName) => {
    const source = sourceRef.current
    if (!source || boundNamesRef.current.has(eventName)) return
    boundNamesRef.current.add(eventName)
    source.addEventListener(eventName, (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return // Malformed body: drop the message.
      }
      const handlers = eventHandlersRef.current.get(eventName)
      if (!handlers) return
      for (const handler of [...handlers]) handler(data)
    })
  }, [])

  const subscribe = useCallback(
    (eventName, handler) => {
      const unsubscribe = addToMap(eventHandlersRef.current, eventName, handler)
      bind(eventName)
      return unsubscribe
    },
    [bind],
  )

  const subscribeReconnect = useCallback((handler) => {
    reconnectHandlersRef.current.add(handler)
    return () => reconnectHandlersRef.current.delete(handler)
  }, [])

  useEffect(() => {
    const EventSourceImpl = getEventSource()
    if (!isAuthenticated || !EventSourceImpl) return undefined

    let source = null
    let timer = null
    let attempt = 0
    let hasOpened = false

    const connect = () => {
      timer = null
      source = new EventSourceImpl(`${API_URL}/events`, { withCredentials: true })
      sourceRef.current = source
      boundNamesRef.current = new Set()
      for (const eventName of eventHandlersRef.current.keys()) bind(eventName)

      source.onopen = () => {
        attempt = 0
        setStatus(REALTIME_STATUS.open)
        if (hasOpened) for (const handler of [...reconnectHandlersRef.current]) handler()
        hasOpened = true
      }

      source.onerror = () => {
        if (source.readyState !== (EventSourceImpl.CLOSED ?? CLOSED)) {
          // The browser is retrying on its own.
          setStatus(REALTIME_STATUS.connecting)
          return
        }
        source.close()
        sourceRef.current = null
        setStatus(REALTIME_STATUS.closed)
        timer = setTimeout(() => {
          setStatus(REALTIME_STATUS.connecting)
          connect()
        }, reconnectDelay(attempt))
        attempt += 1
      }
    }

    connect()

    return () => {
      if (timer) clearTimeout(timer)
      if (source) {
        source.onopen = null
        source.onerror = null
        source.close()
      }
      sourceRef.current = null
      // Ready for the next stream, should one be opened again.
      setStatus(REALTIME_STATUS.connecting)
    }
  }, [isAuthenticated, bind])

  const api = useMemo(() => ({ subscribe, subscribeReconnect }), [subscribe, subscribeReconnect])

  return (
    <RealtimeApiContext.Provider value={api}>
      <RealtimeStatusContext.Provider value={status}>{children}</RealtimeStatusContext.Provider>
    </RealtimeApiContext.Provider>
  )
}
