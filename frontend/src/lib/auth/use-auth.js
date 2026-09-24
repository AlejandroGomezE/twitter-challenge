import { useContext } from 'react'
import { AuthContext } from './auth-context'

// { user, isAuthenticated, isLoading, isError, isFetching, refetch(), signIn(credentials),
//   signUp(credentials), signOut() }
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
