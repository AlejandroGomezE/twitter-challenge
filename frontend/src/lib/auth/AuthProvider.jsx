import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/lib/api/client'
import { AUTH_ME_QUERY_KEY, AuthContext, isAuthMeQuery } from './auth-context'

// Resolves to the signed-in user, or `null` when there is no valid session (401).
async function fetchCurrentUser() {
  try {
    return await apiClient.get('/auth/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function AuthProvider({ children }) {
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
    async (credentials) => {
      const signedIn = await apiClient.post('/auth/sign-in', credentials)
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, signedIn)
      return signedIn
    },
    [queryClient],
  )

  const signUp = useCallback(
    async (credentials) => {
      const signedUp = await apiClient.post('/auth/sign-up', credentials)
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, signedUp)
      return signedUp
    },
    [queryClient],
  )

  const signOut = useCallback(async () => {
    try {
      await apiClient.post('/auth/sign-out')
    } finally {
      // Mark the user as signed out, then drop every other cached query/mutation so no signed-in
      // data survives. The `me` query itself is kept (not removed) because AuthProvider observes it.
      queryClient.setQueryData(AUTH_ME_QUERY_KEY, null)
      queryClient.removeQueries({ predicate: (query) => !isAuthMeQuery(query) })
      queryClient.getMutationCache().clear()
    }
  }, [queryClient])

  const value = useMemo(
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
