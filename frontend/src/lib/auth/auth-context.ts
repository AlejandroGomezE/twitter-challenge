import { createContext } from 'react'
import type { Query, QueryObserverResult } from '@tanstack/react-query'
import type { AuthUser } from '@/lib/api/types'

// Query key for the signed-in user (`GET /auth/me`). `null` data means signed out.
export const AUTH_ME_QUERY_KEY = ['auth', 'me'] as const

// True for the `['auth', 'me']` query itself (used to keep it while dropping every other query).
export const isAuthMeQuery = (query: Pick<Query, 'queryKey'>) =>
  query.queryKey.length === AUTH_ME_QUERY_KEY.length &&
  AUTH_ME_QUERY_KEY.every((part, i) => query.queryKey[i] === part)

export interface SignInCredentials {
  email: string
  password: string
}

export interface SignUpCredentials extends SignInCredentials {
  username: string
  displayName: string
}

export interface AuthContextValue {
  // null when signed out (or still loading).
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  refetch: () => Promise<QueryObserverResult<AuthUser | null>>
  // signIn/signUp/signOut reject with the ApiError so pages can surface it.
  signIn: (credentials: SignInCredentials) => Promise<AuthUser>
  signUp: (credentials: SignUpCredentials) => Promise<AuthUser>
  signOut: () => Promise<void>
}

// Consumed only through `useAuth()` (use-auth.ts), never directly.
export const AuthContext = createContext<AuthContextValue | null>(null)
