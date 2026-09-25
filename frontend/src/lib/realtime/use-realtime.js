import { useContext, useEffect, useRef } from 'react'
import { RealtimeApiContext, RealtimeStatusContext } from './realtime-context'

// Keeps the latest handler in a ref, so a subscription survives handler identity changes (inline
// arrow functions) without resubscribing.
function useLatest(handler) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  return ref
}

// Calls `handler(data)` for every `eventName` message on the stream, with `data` the parsed JSON
// body (messages with malformed JSON are dropped). Subscribes on mount, unsubscribes on unmount.
// A no-op outside a RealtimeProvider or when the browser has no EventSource.
export function useRealtimeEvent(eventName, handler) {
  const { subscribe } = useContext(RealtimeApiContext)
  const handlerRef = useLatest(handler)

  useEffect(
    () => subscribe(eventName, (data) => handlerRef.current(data)),
    [subscribe, eventName, handlerRef],
  )
}

// Calls `handler()` each time the stream opens again after having been open before (events are
// not replayed, so this is the moment to refresh anything that may have been missed).
export function useRealtimeReconnect(handler) {
  const { subscribeReconnect } = useContext(RealtimeApiContext)
  const handlerRef = useLatest(handler)

  useEffect(() => subscribeReconnect(() => handlerRef.current()), [subscribeReconnect, handlerRef])
}

// 'connecting' | 'open' | 'closed' (see REALTIME_STATUS). Always 'closed' outside a provider.
export function useRealtimeStatus() {
  return useContext(RealtimeStatusContext)
}
