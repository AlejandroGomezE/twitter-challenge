import { StrictMode } from 'react'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import { AUTH_ME_QUERY_KEY } from '@/lib/auth/auth-context'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

function LocationDisplay() {
  const location = useLocation()
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
    // Let /auth/me resolve (signed in) and seed another cached query before sign-out completes.
    await waitFor(() =>
      expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toEqual({ id: 'u1', email: 'ada@example.com' }),
    )
    queryClient.setQueryData(['feed'], [{ id: 'p1' }])
    await waitFor(() => expect(calls.count).toBe(1))

    release()

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/sign-in')
    expect(calls.count).toBe(1)
    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull()
    expect(queryClient.getQueryCache().find({ queryKey: AUTH_ME_QUERY_KEY, exact: true })).toBeDefined()
    expect(queryClient.getQueryCache().find({ queryKey: ['feed'] })).toBeUndefined()
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })
})
