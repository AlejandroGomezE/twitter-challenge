import { createContext } from 'react'

// Query key for the signed-in user (`GET /auth/me`). `null` data means signed out.
export const AUTH_ME_QUERY_KEY = ['auth', 'me']

// True for the `['auth', 'me']` query itself (used to keep it while dropping every other query).
export const isAuthMeQuery = (query) =>
  query.queryKey.length === AUTH_ME_QUERY_KEY.length &&
  AUTH_ME_QUERY_KEY.every((part, i) => query.queryKey[i] === part)

// Consumed only through `useAuth()` (use-auth.js), never directly.
export const AuthContext = createContext(null)
