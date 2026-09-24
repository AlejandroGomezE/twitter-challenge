import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

const ADA = { id: 'u1', email: 'ada@example.com', username: 'ada' }
const GOOD_PASSWORD = 'correct horse battery'

const signedOut = () =>
  server.use(http.get(apiUrl('/auth/me'), () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })))

// Records every sign-up request body; responds with `respond()` (defaults to success).
function mockSignUp(respond = () => HttpResponse.json(ADA, { status: 201 })) {
  const requests = []
  server.use(
    http.post(apiUrl('/auth/sign-up'), async ({ request }) => {
      requests.push(await request.json())
      return respond()
    }),
  )
  return requests
}

async function renderSignUp() {
  signedOut()
  const result = renderWithProviders(<AppRouter />, { route: '/sign-up' })
  await screen.findByRole('heading', { name: 'Create an account' })
  return result
}

// `username` defaults to a valid one so tests about other fields stay focused; pass '' to skip it.
async function fillAndSubmit(user, { username = 'ada', email, password, confirmPassword }) {
  for (const [label, value] of [
    ['Username', username],
    ['Email', email],
    ['Password', password],
    ['Confirm password', confirmPassword],
  ]) {
    if (!value) continue
    await user.click(screen.getByLabelText(label))
    await user.paste(value)
  }
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('SignUp', () => {
  describe('client validation (no request sent)', () => {
    it('rejects an invalid email', async () => {
      const requests = mockSignUp()
      const { user } = await renderSignUp()

      await fillAndSubmit(user, {
        email: 'not-an-email',
        password: GOOD_PASSWORD,
        confirmPassword: GOOD_PASSWORD,
      })

      expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
      expect(requests).toHaveLength(0)
    })

    it('rejects a password shorter than 12 characters', async () => {
      const requests = mockSignUp()
      const { user } = await renderSignUp()

      await fillAndSubmit(user, {
        email: 'ada@example.com',
        password: 'a'.repeat(11),
        confirmPassword: 'a'.repeat(11),
      })

      expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument()
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
      expect(requests).toHaveLength(0)
    })

    it('rejects a password longer than 128 characters', async () => {
      const requests = mockSignUp()
      const { user } = await renderSignUp()

      await fillAndSubmit(user, {
        email: 'ada@example.com',
        password: 'a'.repeat(129),
        confirmPassword: 'a'.repeat(129),
      })

      expect(await screen.findByText('Password must be at most 128 characters')).toBeInTheDocument()
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
      expect(requests).toHaveLength(0)
    })

    it('rejects a confirmation that does not match', async () => {
      const requests = mockSignUp()
      const { user } = await renderSignUp()

      await fillAndSubmit(user, {
        email: 'ada@example.com',
        password: GOOD_PASSWORD,
        confirmPassword: `${GOOD_PASSWORD}!`,
      })

      expect(await screen.findByText("Passwords don't match")).toBeInTheDocument()
      expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'false')
      expect(requests).toHaveLength(0)
    })

    it('requires a username', async () => {
      const requests = mockSignUp()
      const { user } = await renderSignUp()

      await fillAndSubmit(user, {
        username: '',
        email: 'ada@example.com',
        password: GOOD_PASSWORD,
        confirmPassword: GOOD_PASSWORD,
      })

      expect(await screen.findByText('Username must be at least 3 characters')).toBeInTheDocument()
      expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true')
      expect(requests).toHaveLength(0)
    })

    it.each([
      ['ab', 'Username must be at least 3 characters'],
      ['a'.repeat(21), 'Username must be at most 20 characters'],
      ['ada lovelace', 'Only letters, numbers and underscores'],
      ['ada-l', 'Only letters, numbers and underscores'],
      ['Settings', "This username isn't available"],
      [' ADMIN ', "This username isn't available"],
    ])('rejects the username %j', async (username, message) => {
      const requests = mockSignUp()
      const { user } = await renderSignUp()

      await fillAndSubmit(user, {
        username,
        email: 'ada@example.com',
        password: GOOD_PASSWORD,
        confirmPassword: GOOD_PASSWORD,
      })

      expect(await screen.findByText(message)).toBeInTheDocument()
      const input = screen.getByLabelText('Username')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input.getAttribute('aria-describedby')).toContain('sign-up-username-error')
      expect(requests).toHaveLength(0)
    })
  })

  it('posts { email, password, username } (normalized, never confirmPassword) and lands on Home', async () => {
    const requests = mockSignUp()
    const { user } = await renderSignUp()

    await fillAndSubmit(user, {
      username: '  Ada_Lovelace ',
      email: '  ada@example.com ',
      password: GOOD_PASSWORD,
      confirmPassword: GOOD_PASSWORD,
    })

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(requests).toEqual([
      { email: 'ada@example.com', password: GOOD_PASSWORD, username: 'ada_lovelace' },
    ])
  })

  it('shows a 409 username-taken message as-is', async () => {
    mockSignUp(() =>
      HttpResponse.json({ message: 'Username is already taken', statusCode: 409 }, { status: 409 }),
    )
    const { user } = await renderSignUp()

    await fillAndSubmit(user, {
      email: 'ada@example.com',
      password: GOOD_PASSWORD,
      confirmPassword: GOOD_PASSWORD,
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Username is already taken')
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
  })

  it('shows a 409 message as-is', async () => {
    mockSignUp(() =>
      HttpResponse.json({ message: 'Email is already registered', statusCode: 409 }, { status: 409 }),
    )
    const { user } = await renderSignUp()

    await fillAndSubmit(user, {
      email: 'ada@example.com',
      password: GOOD_PASSWORD,
      confirmPassword: GOOD_PASSWORD,
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Email is already registered')
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
  })

  it('joins an array of validation messages', async () => {
    mockSignUp(() =>
      HttpResponse.json(
        { message: ['email must be an email', 'password is too weak'], statusCode: 400 },
        { status: 400 },
      ),
    )
    const { user } = await renderSignUp()

    await fillAndSubmit(user, {
      email: 'ada@example.com',
      password: GOOD_PASSWORD,
      confirmPassword: GOOD_PASSWORD,
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'email must be an email. password is too weak',
    )
  })
})
