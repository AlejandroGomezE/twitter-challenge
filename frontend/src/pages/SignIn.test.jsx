import { http, HttpResponse } from 'msw'
import { screen, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { SignIn } from './SignIn'

const ADA = { id: 'u1', email: 'ada@example.com' }

function LocationDisplay() {
  const location = useLocation()
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>
}

const signedOut = () =>
  server.use(http.get(apiUrl('/auth/me'), () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })))

// Records every sign-in request; responds with `respond(body)` (defaults to success).
function mockSignIn(respond = () => HttpResponse.json(ADA)) {
  const requests = []
  server.use(
    http.post(apiUrl('/auth/sign-in'), async ({ request }) => {
      const body = await request.json()
      requests.push(body)
      return respond(body)
    }),
  )
  return requests
}

async function fillAndSubmit(user, { email, password }) {
  if (email) {
    await user.click(screen.getByLabelText('Email'))
    await user.paste(email)
  }
  if (password) {
    await user.click(screen.getByLabelText('Password'))
    await user.paste(password)
  }
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignIn', () => {
  describe('client validation', () => {
    it('rejects an invalid email without sending a request', async () => {
      signedOut()
      const requests = mockSignIn()
      const { user } = renderWithProviders(<AppRouter />, { route: '/sign-in' })
      await screen.findByRole('heading', { name: 'Sign in' })

      await fillAndSubmit(user, { email: 'not-an-email', password: 'secret' })

      expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'false')
      expect(requests).toHaveLength(0)
    })

    it('requires a password without sending a request', async () => {
      signedOut()
      const requests = mockSignIn()
      const { user } = renderWithProviders(<AppRouter />, { route: '/sign-in' })
      await screen.findByRole('heading', { name: 'Sign in' })

      await fillAndSubmit(user, { email: 'ada@example.com' })

      expect(await screen.findByText('Password is required')).toBeInTheDocument()
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Password is required')
      expect(requests).toHaveLength(0)
    })
  })

  it('posts the trimmed credentials and lands on Home', async () => {
    signedOut()
    const requests = mockSignIn()
    const { user } = renderWithProviders(<AppRouter />, { route: '/sign-in' })
    await screen.findByRole('heading', { name: 'Sign in' })

    await fillAndSubmit(user, { email: '  ada@example.com  ', password: 'correct horse' })

    expect(await screen.findByText('Signed in as ada@example.com')).toBeInTheDocument()
    expect(requests).toEqual([{ email: 'ada@example.com', password: 'correct horse' }])
  })

  it('returns to the originally requested route after signing in', async () => {
    signedOut()
    mockSignIn()
    const { user } = renderWithProviders(
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/sign-in" element={<SignIn />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<p>home</p>} />
          <Route
            path="/some/page"
            element={
              <>
                <p>target</p>
                <LocationDisplay />
              </>
            }
          />
        </Route>
      </Routes>,
      { route: '/some/page?x=1' },
    )
    // ProtectedRoute bounces the signed-out user to /sign-in, remembering where they were headed.
    await screen.findByRole('heading', { name: 'Sign in' })

    await fillAndSubmit(user, { email: 'ada@example.com', password: 'correct horse' })

    expect(await screen.findByText('target')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/some/page?x=1')
    expect(screen.queryByText('home')).not.toBeInTheDocument()
  })

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com'])(
    'ignores a foreign redirect target (%s) and lands on /',
    async (pathname) => {
      mockSignIn()
      const { user } = renderWithProviders(
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/" element={<p>home</p>} />
          <Route
            path="*"
            element={
              <>
                <p>foreign</p>
                <LocationDisplay />
              </>
            }
          />
        </Routes>,
        { route: { pathname: '/sign-in', state: { from: { pathname, search: '' } } } },
      )

      await fillAndSubmit(user, { email: 'ada@example.com', password: 'correct horse' })

      expect(await screen.findByText('home')).toBeInTheDocument()
      expect(screen.queryByText('foreign')).not.toBeInTheDocument()
    },
  )

  it('shows "Invalid email or password" on a 401', async () => {
    signedOut()
    mockSignIn(() => HttpResponse.json({ message: 'Invalid email or password', statusCode: 401 }, { status: 401 }))
    const { user } = renderWithProviders(<AppRouter />, { route: '/sign-in' })
    await screen.findByRole('heading', { name: 'Sign in' })

    await fillAndSubmit(user, { email: 'ada@example.com', password: 'wrong password' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows a friendly message on a 429', async () => {
    signedOut()
    mockSignIn(() => HttpResponse.json({ message: 'ThrottlerException: Too Many Requests' }, { status: 429 }))
    const { user } = renderWithProviders(<AppRouter />, { route: '/sign-in' })
    await screen.findByRole('heading', { name: 'Sign in' })

    await fillAndSubmit(user, { email: 'ada@example.com', password: 'correct horse' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in a minute.')
  })

  it('disables the button and shows a spinner while submitting', async () => {
    signedOut()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    mockSignIn(async () => {
      await gate
      return HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 })
    })
    const { user } = renderWithProviders(<AppRouter />, { route: '/sign-in' })
    await screen.findByRole('heading', { name: 'Sign in' })

    await fillAndSubmit(user, { email: 'ada@example.com', password: 'correct horse' })

    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(button).toBeDisabled()
    expect(within(button).getByRole('status', { hidden: true })).toBeInTheDocument()

    release()

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(button).toBeEnabled()
    expect(within(button).queryByRole('status', { hidden: true })).not.toBeInTheDocument()
  })
})
