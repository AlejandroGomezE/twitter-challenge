import { useState } from 'react'
import { http, HttpResponse } from 'msw'
import { renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { AUTH_ME_QUERY_KEY } from './auth-context'
import { useAuth } from './use-auth'

const CREDENTIALS = { email: 'ada@example.com', password: 'correct horse battery' }

// Renders the auth state and exposes signIn/signUp as buttons whose outcome is printed.
function AuthConsumer() {
  const auth = useAuth()
  const [outcome, setOutcome] = useState('')

  const run = (action) =>
    auth[action](CREDENTIALS).then(
      (result) => setOutcome(`resolved ${result.email}`),
      (error) => setOutcome(`rejected ${error.name} ${error.status} ${error.message}`),
    )

  return (
    <>
      <p>loading: {String(auth.isLoading)}</p>
      <p>authenticated: {String(auth.isAuthenticated)}</p>
      <p>error: {String(auth.isError)}</p>
      <p>user: {auth.user ? auth.user.email : 'none'}</p>
      <button onClick={() => run('signIn')}>sign in</button>
      <button onClick={() => run('signUp')}>sign up</button>
      <p>outcome: {outcome}</p>
    </>
  )
}

const meResponds = (resolver) => server.use(http.get(apiUrl('/auth/me'), resolver))

describe('AuthProvider / useAuth', () => {
  it('is authenticated when /auth/me returns the user', async () => {
    renderWithProviders(<AuthConsumer />)

    expect(screen.getByText('loading: true')).toBeInTheDocument()
    expect(await screen.findByText('user: ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('authenticated: true')).toBeInTheDocument()
    expect(screen.getByText('loading: false')).toBeInTheDocument()
    expect(screen.getByText('error: false')).toBeInTheDocument()
  })

  it('treats a 401 as signed out, not as an error', async () => {
    meResponds(() => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }))

    const { queryClient } = renderWithProviders(<AuthConsumer />)

    expect(await screen.findByText('loading: false')).toBeInTheDocument()
    expect(screen.getByText('authenticated: false')).toBeInTheDocument()
    expect(screen.getByText('user: none')).toBeInTheDocument()
    expect(screen.getByText('error: false')).toBeInTheDocument()
    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull()
  })

  it('surfaces a 500 as an error rather than signed out', async () => {
    let requests = 0
    meResponds(() => {
      requests += 1
      return HttpResponse.json({ message: 'Server error' }, { status: 500 })
    })

    const { queryClient } = renderWithProviders(<AuthConsumer />)

    expect(await screen.findByText('error: true')).toBeInTheDocument()
    expect(screen.getByText('authenticated: false')).toBeInTheDocument()
    expect(screen.getByText('user: none')).toBeInTheDocument()
    expect(screen.getByText('loading: false')).toBeInTheDocument()
    // Not converted to the signed-out `null`, and not retried automatically.
    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeUndefined()
    expect(requests).toBe(1)
  })

  it('throws when used outside an AuthProvider', () => {
    // React logs the render error; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider')

    consoleError.mockRestore()
  })

  it.each([
    ['signIn', 'sign in', '/auth/sign-in', 401, 'Invalid email or password'],
    ['signUp', 'sign up', '/auth/sign-up', 409, 'Email is already registered'],
  ])('%s rejects with the ApiError on failure', async (_, button, path, status, message) => {
    server.use(http.post(apiUrl(path), () => HttpResponse.json({ message }, { status })))
    const { user } = renderWithProviders(<AuthConsumer />)
    await screen.findByText('user: ada@example.com')

    await user.click(screen.getByRole('button', { name: button }))

    expect(await screen.findByText(`outcome: rejected ApiError ${status} ${message}`)).toBeInTheDocument()
  })

  it.each([
    ['signIn', 'sign in', '/auth/sign-in'],
    ['signUp', 'sign up', '/auth/sign-up'],
  ])('%s resolves with the user and seeds the auth state', async (_, button, path) => {
    meResponds(() => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }))
    server.use(http.post(apiUrl(path), () => HttpResponse.json({ id: 'u2', email: 'grace@example.com' })))
    const { user } = renderWithProviders(<AuthConsumer />)
    await screen.findByText('user: none')

    await user.click(screen.getByRole('button', { name: button }))

    expect(await screen.findByText('outcome: resolved grace@example.com')).toBeInTheDocument()
    expect(screen.getByText('user: grace@example.com')).toBeInTheDocument()
    expect(screen.getByText('authenticated: true')).toBeInTheDocument()
  })
})
