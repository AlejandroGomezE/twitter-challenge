import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { AppRouter } from '../router'

function LocationDisplay() {
  const location = useLocation()
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>
}

function renderApp(route) {
  return renderWithProviders(
    <>
      <AppRouter />
      <LocationDisplay />
    </>,
    { route },
  )
}

const signedOut = () =>
  server.use(http.get(apiUrl('/auth/me'), () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })))

describe('AppRouter', () => {
  describe('signed out', () => {
    it.each(['/', '/anything/deep'])('redirects %s to the sign-in page', async (route) => {
      signedOut()

      renderApp(route)

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/sign-in')
      expect(screen.queryByRole('heading', { name: 'Home' })).not.toBeInTheDocument()
    })

    it('shows the sign-up page at /sign-up', async () => {
      signedOut()

      renderApp('/sign-up')

      expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/sign-up')
    })

    it('shows a spinner and no protected content while /auth/me is pending', async () => {
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      server.use(
        http.get(apiUrl('/auth/me'), async () => {
          await gate
          return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
        }),
      )

      renderApp('/')

      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Home' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()

      release()

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    })
  })

  describe('/auth/me fails with a non-401 error', () => {
    // The me query is observed by AuthProvider; `status` switches what the next request returns.
    function mockMe(initialStatus) {
      const me = { status: initialStatus, requests: 0 }
      server.use(
        http.get(apiUrl('/auth/me'), () => {
          me.requests += 1
          if (me.status === 200) return HttpResponse.json({ id: 'u1', email: 'ada@example.com' })
          return HttpResponse.json({ message: 'Server error' }, { status: me.status })
        }),
      )
      return me
    }

    it('shows an error with a Retry button at / instead of redirecting', async () => {
      mockMe(500)

      renderApp('/')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't reach the server. Check your connection and try again.",
      )
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    })

    it('shows Home once a retry succeeds', async () => {
      const me = mockMe(500)
      const { user } = renderApp('/')
      const retry = await screen.findByRole('button', { name: 'Retry' })

      me.status = 200
      await user.click(retry)

      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
      expect(me.requests).toBe(2)
    })

    // With no cached user, TanStack Query puts a refetching errored query back into `pending`, so
    // the retry shows ProtectedRoute's loading spinner (not the disabled Retry button).
    it('shows the loading spinner while retrying, then the error again if it still fails', async () => {
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      let calls = 0
      server.use(
        http.get(apiUrl('/auth/me'), async () => {
          calls += 1
          if (calls > 1) await gate
          return HttpResponse.json({ message: 'Server error' }, { status: 500 })
        }),
      )
      const { user } = renderApp('/')
      const retry = await screen.findByRole('button', { name: 'Retry' })

      await user.click(retry)

      expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()

      release()

      expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled()
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
      expect(calls).toBe(2)
    })

    it('goes to the sign-in page when the retry answers 401', async () => {
      const me = mockMe(500)
      const { user } = renderApp('/')
      const retry = await screen.findByRole('button', { name: 'Retry' })

      me.status = 401
      await user.click(retry)

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/sign-in')
    })

    it.each([
      ['/sign-in', 'Sign in'],
      ['/sign-up', 'Create an account'],
    ])('still renders the form at %s', async (route, heading) => {
      mockMe(500)

      renderApp(route)

      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('signed in', () => {
    it.each(['/sign-in', '/sign-up'])('redirects %s to Home', async (route) => {
      renderApp(route)

      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Create an account' })).not.toBeInTheDocument()
    })

    it('shows Home at /', async () => {
      renderApp('/')

      expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    })

    it('shows the Notifications page at /notifications', async () => {
      server.use(
        http.get(apiUrl('/notifications'), () => HttpResponse.json({ items: [], nextCursor: null })),
        http.get(apiUrl('/notifications/unread-count'), () => HttpResponse.json({ count: 0 })),
      )

      renderApp('/notifications')

      expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/notifications')
    })
  })
})
