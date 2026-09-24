import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigate } from 'react-router'
import { AuthLayout } from '@/components/AuthLayout'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth/use-auth'

// The app's single sign-out path. Fires `signOut()` once on mount, then sends the user to /sign-in
// whether the request succeeded or failed (AuthProvider clears local auth state either way).
export function SignOut() {
  const { signOut, isAuthenticated } = useAuth()
  const { mutate, isSuccess, isError } = useMutation({ mutationFn: signOut })
  // StrictMode runs mount effects twice in development; the ref keeps it to one request.
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    mutate()
  }, [mutate])

  // Wait until AuthProvider has re-rendered with the signed-out user too: the mutation can settle a
  // render before the `me` = null update reaches the context, and redirecting then would let
  // PublicOnlyRoute see a stale signed-in user and bounce /sign-in → / → /sign-in.
  if ((isSuccess || isError) && !isAuthenticated) {
    return <Navigate to="/sign-in" replace />
  }

  return (
    <AuthLayout title="Signing out">
      <div className="flex w-full items-center justify-center gap-2 rounded-2xl border bg-card p-6 text-muted-foreground shadow-sm">
        <Spinner className="text-primary" />
        <p>Signing out…</p>
      </div>
    </AuthLayout>
  )
}
