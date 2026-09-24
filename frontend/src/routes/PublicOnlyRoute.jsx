import { Navigate, Outlet, useLocation } from 'react-router'
import { Spinner } from '@/components/ui/spinner'
import { getRedirectTarget } from '@/lib/auth/redirect-target'
import { useAuth } from '@/lib/auth/use-auth'

// For /sign-in and /sign-up: signed-in users are sent to the page ProtectedRoute bounced them from
// (`location.state.from`, in-app paths only), else home. This also covers the moment signIn/signUp
// seed the user, so it is what returns a freshly signed-in user to their original route.
// If /auth/me failed with a non-401 error, the page still renders: signing in / up surfaces its
// own error if the server is unreachable.
export function PublicOnlyRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to={getRedirectTarget(location.state?.from)} replace />
  }

  return <Outlet />
}
