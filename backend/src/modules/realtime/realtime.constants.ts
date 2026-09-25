// Injection token for the heartbeat interval of GET /events, so unit tests
// can shorten it. RealtimeModule provides DEFAULT_HEARTBEAT_INTERVAL_MS.
export const REALTIME_HEARTBEAT_INTERVAL_MS = Symbol(
  'REALTIME_HEARTBEAT_INTERVAL_MS',
);

// Every 25s: below the common 30s-60s idle timeouts of proxies, and the
// longest time a signed-out session's stream stays open.
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;

// Open streams per user (roughly one per browser tab). Opening one more
// closes the oldest, so a user can't pile up connections on the server.
export const MAX_STREAMS_PER_USER = 5;

// Stream event names of the GET /events contract (realtime-updates feature).
export const RealtimeEvent = {
  PostCreated: 'post.created',
  PostDeleted: 'post.deleted',
  PostCounts: 'post.counts',
  NotificationsChanged: 'notifications.changed',
} as const;
