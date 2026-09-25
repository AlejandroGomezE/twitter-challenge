import { Navigate, Outlet, useLocation } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth/use-auth'
import { NewPostsProvider } from '@/lib/realtime/NewPostsProvider'
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'

// Gates its child routes on a signed-in user; otherwise sends them to /sign-in, remembering where
// they were headed in `location.state.from`. If /auth/me failed with anything but a 401 (server
// down, network), the session state is unknown, so it shows an error with a Retry button instead
// of pretending the user is signed out. The signed-in tree gets the realtime stream
// (RealtimeProvider), so it never opens on the public pages and closes on sign-out, and the
// new-posts tracker behind Home's pill (NewPostsProvider), so its counts outlive a visit to Home.
export function ProtectedRoute() {
  const { isAuthenticated, isLoading, isError, isFetching, refetch } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <Alert variant="destructive">
            <AlertDescription>
              Couldn&apos;t reach the server. Check your connection and try again.
            </AlertDescription>
          </Alert>
          <Button onClick={() => refetch()} disabled={isFetching}>
            {isFetching && <Spinner aria-hidden="true" />}
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/sign-in" replace state={{ from: location }} />
  }

  return (
    <RealtimeProvider>
      <NewPostsProvider>
        <Outlet />
      </NewPostsProvider>
    </RealtimeProvider>
  )
}
