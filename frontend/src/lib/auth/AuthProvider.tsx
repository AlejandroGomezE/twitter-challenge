import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { resetFollowBursts } from '@/hooks/use-follows'
import { resetLikeBursts } from '@/hooks/use-posts'
import { ApiError, apiClient } from '@/lib/api/client'
import type { AuthUser } from '@/lib/api/types'
import {
  AUTH_ME_QUERY_KEY,
  AuthContext,
  isAuthMeQuery,
  type AuthContextValue,
  type SignInCredentials,
  type SignUpCredentials,
} from './auth-context'

// Resolves to the signed-in user, or `null` when there is no valid session (401).
async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return await apiClient.get<AuthUser>('/auth/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  // Only a 401 means signed out (resolved to `null` above). Any other failure (500, network) is an
  // error the route guards surface with a Retry button — no automatic retries.
  const {
    data: user,
    isPending,
    isError: queryFailed,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 5 * 60_000,
  })
  // A failed background refetch keeps a previously loaded user signed in.
  const isError = queryFailed && !user

  // signIn/signUp/signOut reject with the ApiError so pages can surface it.
  const signIn = useCallback(
    async (credentials: SignInCredentials) => {
      const signedIn = await apiClient.post<AuthUser>('/auth/sign-in', credentials)
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, signedIn)
      return signedIn
    },
    [queryClient],
  )

  const signUp = useCallback(
    async (credentials: SignUpCredentials) => {
      const signedUp = await apiClient.post<AuthUser>('/auth/sign-up', credentials)
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, signedUp)
      return signedUp
    },
    [queryClient],
  )

  const signOut = useCallback(async () => {
    // An in-flight `GET /auth/me` (e.g. the one sent on a fresh page load of /sign-out) was
    // authorised by the session being revoked; if it resolved after we mark the user signed out it
    // would write the user back into the cache. Cancel it before the request and again after (a
    // refetch may have started meanwhile), so only the `null` below can land.
    const cancelMe = () => queryClient.cancelQueries({ queryKey: AUTH_ME_QUERY_KEY, exact: true })
    await cancelMe()
    try {
      await apiClient.post('/auth/sign-out')
    } finally {
      await cancelMe()
      // Mark the user as signed out, then drop every other cached query/mutation so no signed-in
      // data survives. The `me` query itself is kept (not removed) because AuthProvider observes it.
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, null)
      queryClient.removeQueries({ predicate: (query) => !isAuthMeQuery(query) })
      queryClient.getMutationCache().clear()
      // Like / follow bursts live outside the cache (per QueryClient) — forget them too, so a like
      // or follow still in flight can't write into the next user's cache.
      resetLikeBursts(queryClient)
      resetFollowBursts(queryClient)
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: user ?? null,
      isAuthenticated: Boolean(user),
      isLoading: isPending,
      isError,
      isFetching,
      refetch,
      signIn,
      signUp,
      signOut,
    }),
    [user, isPending, isError, isFetching, refetch, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
