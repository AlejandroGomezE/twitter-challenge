import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import { profileQueryKey } from '@/lib/api/users'
import { AUTH_ME_QUERY_KEY } from '@/lib/auth/auth-context'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

const CREATED_AT = '2026-09-15T12:00:00.000Z'
const ADA_PROFILE = { username: 'ada', bio: 'Math & engines', createdAt: CREATED_AT }

function LocationDisplay() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

// Serves `GET /users/:username` from `profiles` (404 otherwise).
function mockProfiles(profiles = { ada: ADA_PROFILE }) {
  server.use(
    http.get(apiUrl('/users/:username'), ({ params }) => {
      const profile = profiles[params.username.toLowerCase()]
      if (!profile) return HttpResponse.json({ message: 'User not found' }, { status: 404 })
      return HttpResponse.json(profile)
    }),
  )
}

// Records every `PATCH /users/me` body. By default echoes a successful update of ada's profile.
function mockPatch(
  respond = (body) =>
    HttpResponse.json({
      id: 'u1',
      email: 'ada@example.com',
      username: body.username ?? 'ada',
      bio: 'bio' in body ? body.bio || null : ADA_PROFILE.bio,
      createdAt: CREATED_AT,
    }),
) {
  const requests = []
  server.use(
    http.patch(apiUrl('/users/me'), async ({ request }) => {
      const body = await request.json()
      requests.push(body)
      return respond(body)
    }),
  )
  return requests
}

async function renderEditProfile() {
  const result = renderWithProviders(
    <>
      <AppRouter />
      <LocationDisplay />
    </>,
    { route: '/settings/profile' },
  )
  await screen.findByLabelText('Username')
  return result
}

async function replaceText(user, label, value) {
  const field = screen.getByLabelText(label)
  await user.clear(field)
  if (value) {
    await user.click(field)
    await user.paste(value)
  }
}

const save = (user) => user.click(screen.getByRole('button', { name: 'Save' }))

// The page content, without the app shell (whose profile card repeats the signed-in user's avatar
// and bio).
const page = () => within(screen.getByRole('main'))

describe('EditProfile', () => {
  describe('loading', () => {
    it('shows a loading state, then the form prefilled with the current username and bio', async () => {
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      let requested
      const received = new Promise((resolve) => {
        requested = resolve
      })
      server.use(
        http.get(apiUrl('/users/:username'), async () => {
          requested()
          await gate
          return HttpResponse.json(ADA_PROFILE)
        }),
      )

      renderWithProviders(<AppRouter />, { route: '/settings/profile' })
      await received

      expect(screen.getByRole('heading', { name: 'Edit profile' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to your profile' })).toHaveAttribute('href', '/u/ada')
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
      expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()

      release()

      expect(await screen.findByLabelText('Username')).toHaveValue('ada')
      expect(screen.getByLabelText('Bio')).toHaveValue('Math & engines')
      expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    })

    it('prefills an empty bio when the user has none', async () => {
      mockProfiles({ ada: { ...ADA_PROFILE, bio: null } })

      await renderEditProfile()

      expect(screen.getByLabelText('Bio')).toHaveValue('')
      expect(screen.getByText('0/160')).toBeInTheDocument()
    })
  })

  describe('bio counter', () => {
    it('counts the (trimmed) bio length', async () => {
      mockProfiles()
      const { user } = await renderEditProfile()

      expect(screen.getByText('14/160')).toBeInTheDocument()

      await replaceText(user, 'Bio', '  hello  ')

      expect(screen.getByText('5/160')).toBeInTheDocument()
    })

    it('turns destructive over 160 characters and blocks saving', async () => {
      mockProfiles()
      const requests = mockPatch()
      const { user } = await renderEditProfile()

      await replaceText(user, 'Bio', 'a'.repeat(160))
      expect(screen.getByText('160/160')).not.toHaveClass('text-destructive')

      await user.type(screen.getByLabelText('Bio'), 'b')
      const counter = screen.getByText('161/160')
      expect(counter).toHaveClass('text-destructive')

      await save(user)

      expect(await screen.findByText('Bio must be 160 characters or fewer')).toBeInTheDocument()
      expect(screen.getByLabelText('Bio')).toHaveAttribute('aria-invalid', 'true')
      expect(requests).toHaveLength(0)
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/profile')
    })
  })

  describe('client validation (no request sent)', () => {
    it.each([
      ['admin', "This username isn't available"],
      ['ab', 'Username must be at least 3 characters'],
      ['ada-l', 'Only letters, numbers and underscores'],
    ])('rejects the username %j', async (username, message) => {
      mockProfiles()
      const requests = mockPatch()
      const { user } = await renderEditProfile()

      await replaceText(user, 'Username', username)
      await save(user)

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true')
      expect(requests).toHaveLength(0)
    })
  })

  describe('submitting', () => {
    it('sends only the bio when only the bio changed', async () => {
      mockProfiles()
      const requests = mockPatch()
      const { user } = await renderEditProfile()

      await replaceText(user, 'Bio', '  New bio  ')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ bio: 'New bio' }]))
      expect(await page().findByText('New bio')).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
    })

    it('sends only the normalized username when only the username changed', async () => {
      mockProfiles()
      const requests = mockPatch()
      const { user } = await renderEditProfile()

      await replaceText(user, 'Username', '  Ada_L ')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ username: 'ada_l' }]))
    })

    it('sends bio "" when the bio is cleared', async () => {
      mockProfiles()
      const requests = mockPatch()
      const { user } = await renderEditProfile()

      await replaceText(user, 'Bio', '')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ bio: '' }]))
      expect(await page().findByText('No bio yet.')).toBeInTheDocument()
    })

    it.each(['ada', 'ADA'])(
      'goes to your profile without a PATCH when nothing changed (username %j)',
      async (username) => {
        mockProfiles()
        const requests = mockPatch()
        const { user } = await renderEditProfile()

        await replaceText(user, 'Username', username)
        await save(user)

        expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
        expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
        expect(requests).toHaveLength(0)
      },
    )

    it('shows the server error when the username is taken', async () => {
      mockProfiles()
      mockPatch(() => HttpResponse.json({ message: 'Username is already taken' }, { status: 409 }))
      const { user } = await renderEditProfile()

      await replaceText(user, 'Username', 'grace')
      await save(user)

      expect(await screen.findByRole('alert')).toHaveTextContent('Username is already taken')
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/profile')
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('disables Save and shows a spinner while saving', async () => {
      mockProfiles()
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      mockPatch(async (body) => {
        await gate
        return HttpResponse.json({ id: 'u1', email: 'ada@example.com', username: 'ada', bio: body.bio, createdAt: CREATED_AT })
      })
      const { user } = await renderEditProfile()

      await replaceText(user, 'Bio', 'Saving…')
      await save(user)

      const saveButton = screen.getByRole('button', { name: 'Save' })
      await waitFor(() => expect(saveButton).toBeDisabled())
      expect(saveButton.querySelector('[data-slot="spinner"]')).not.toBeNull()

      release()

      expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
    })

    it('after a username change lands on /u/<new> with the new data and no stale username cached', async () => {
      mockProfiles()
      const requests = mockPatch()
      const { user, queryClient } = await renderEditProfile()
      expect(queryClient.getQueryData(profileQueryKey('ada'))).toEqual(ADA_PROFILE)

      await replaceText(user, 'Username', 'Ada_L')
      await replaceText(user, 'Bio', 'Renamed')
      await save(user)

      expect(await screen.findByRole('heading', { name: '@ada_l' })).toBeInTheDocument()
      expect(requests).toEqual([{ username: 'ada_l', bio: 'Renamed' }])
      expect(screen.getByTestId('location')).toHaveTextContent('/u/ada_l')
      expect(page().getByText('Renamed')).toBeInTheDocument()
      expect(page().getByRole('img', { name: '@ada_l' })).toBeInTheDocument()
      // Still your own profile under the new name.
      expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/settings/profile')

      expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toEqual({
        id: 'u1',
        email: 'ada@example.com',
        username: 'ada_l',
      })
      expect(queryClient.getQueryData(profileQueryKey('ada_l'))).toEqual({
        username: 'ada_l',
        bio: 'Renamed',
        createdAt: CREATED_AT,
      })
      expect(queryClient.getQueryState(profileQueryKey('ada'))).toBeUndefined()
    })
  })

  it('Cancel goes back to your own profile', async () => {
    mockProfiles()
    const requests = mockPatch()
    const { user } = await renderEditProfile()

    const cancel = screen.getByRole('link', { name: 'Cancel' })
    expect(cancel).toHaveAttribute('href', '/u/ada')
    await replaceText(user, 'Bio', 'unsaved')
    await user.click(cancel)

    expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
    expect(page().getByText('Math & engines')).toBeInTheDocument()
    expect(requests).toHaveLength(0)
  })
})
