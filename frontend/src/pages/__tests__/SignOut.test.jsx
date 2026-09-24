import { StrictMode } from 'react'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import { AUTH_ME_QUERY_KEY } from '@/lib/auth/auth-context'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

function LocationDisplay({ visited }) {
  const location = useLocation()
  visited?.push(location.pathname)
  return <p data-testid="location">{location.pathname}</p>
}

// Holds `POST /auth/sign-out` until `release()` so the test can inspect the in-flight state.
function mockSignOut(response) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const calls = { count: 0 }
  server.use(
    http.post(apiUrl('/auth/sign-out'), async () => {
      calls.count += 1
      await gate
      return response()
    }),
  )
  return { calls, release }
}

describe('SignOut', () => {
  it.each([
    ['a 204', () => new HttpResponse(null, { status: 204 })],
    ['a 500 failure', () => HttpResponse.json({ message: 'Server error' }, { status: 500 })],
  ])('signs out once and redirects to /sign-in on %s', async (_, response) => {
    const { calls, release } = mockSignOut(response)

    const { queryClient } = renderWithProviders(
      <StrictMode>
        <AppRouter />
        <LocationDisplay />
      </StrictMode>,
      { route: '/sign-out' },
    )

    expect(screen.getByText('Signing out…')).toBeInTheDocument()
    // Seed another cached query while the sign-out request is in flight. (The load-time /auth/me
    // is cancelled by signOut, so it never lands the user here — see the race test below.)
    await waitFor(() => expect(calls.count).toBe(1))
    queryClient.setQueryData(['feed'], [{ id: 'p1' }])

    release()

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/sign-in')
    expect(calls.count).toBe(1)
    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull()
    expect(queryClient.getQueryCache().find({ queryKey: AUTH_ME_QUERY_KEY, exact: true })).toBeDefined()
    expect(queryClient.getQueryCache().find({ queryKey: ['feed'] })).toBeUndefined()
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  // Fresh page load of /sign-out: the `GET /auth/me` sent on load is still in flight when the
  // sign-out request completes. Its late 200 must not restore the user (which would bounce
  // /sign-in back to Home with a revoked session).
  it('ignores a /auth/me response that lands after sign-out', async () => {
    let releaseMe
    const meGate = new Promise((resolve) => {
      releaseMe = resolve
    })
    const me = { requests: 0, responded: false }
    const signOutCalls = { count: 0 }
    server.use(
      http.get(apiUrl('/auth/me'), async () => {
        me.requests += 1
        await meGate
        me.responded = true
        return HttpResponse.json({ id: 'u1', email: 'ada@example.com', username: 'ada' })
      }),
      http.post(apiUrl('/auth/sign-out'), () => {
        signOutCalls.count += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { queryClient } = renderWithProviders(
      <StrictMode>
        <AppRouter />
        <LocationDisplay />
      </StrictMode>,
      { route: '/sign-out' },
    )

    // Sign-out completes (me set to `null`) while the load-time /auth/me is still pending.
    await waitFor(() => expect(signOutCalls.count).toBe(1))
    await waitFor(() => expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull())
    expect(me.requests).toBe(1)
    expect(me.responded).toBe(false)

    releaseMe()
    await waitFor(() => expect(me.responded).toBe(true))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    // Give the late response time to (wrongly) restore the user and bounce to Home.
    await expect(screen.findByText(/Signed in as/, {}, { timeout: 300 })).rejects.toThrow()
    expect(screen.getByTestId('location')).toHaveTextContent('/sign-in')
    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull()
    expect(signOutCalls.count).toBe(1)
  })

  it('signs out once from the in-app "Sign out" link', async () => {
    const signOutCalls = { count: 0 }
    server.use(
      http.post(apiUrl('/auth/sign-out'), () => {
        signOutCalls.count += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const visited = []
    const { user, queryClient } = renderWithProviders(
      <StrictMode>
        <AppRouter />
        <LocationDisplay visited={visited} />
      </StrictMode>,
      { route: '/' },
    )

    await screen.findByText('Signed in as ada@example.com')
    visited.length = 0
    await user.click(screen.getByRole('link', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/sign-in')
    // Nothing fires a second request once the page has settled.
    await expect(screen.findByText(/Signed in as/, {}, { timeout: 300 })).rejects.toThrow()
    expect(signOutCalls.count).toBe(1)
    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull()
    // Straight to /sign-in: no bounce back through Home on a stale signed-in state.
    expect([...new Set(visited)]).toEqual(['/sign-out', '/sign-in'])
  })
})
