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
// Ada has no display name yet (like every account created before names existed).
const ADA_PROFILE = { username: 'ada', displayName: null, bio: 'Math & engines', createdAt: CREATED_AT }
const NAMED_ADA_PROFILE = { ...ADA_PROFILE, displayName: 'Ada Lovelace' }

function LocationDisplay() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

// A fake of the API's user profiles, created per test so no state leaks between tests. `GET
// /users/:username` reads it and a successful `PATCH /users/me` writes to it, so the profile page's
// refetch after "Save" returns the saved profile, like the real API.
function createProfileStore(profiles) {
  const byUsername = new Map(
    Object.values(profiles).map((profile) => [profile.username.toLowerCase(), { ...profile }]),
  )
  // The signed-in user (the default `GET /auth/me` handler signs in as ada).
  let me = 'ada'
  return {
    // Every profile request served, in order: `GET /users/<username>` and `PATCH /users/me`.
    log: [],
    get: (username) => byUsername.get(username.toLowerCase()),
    me: () => byUsername.get(me),
    // Applies a saved `PATCH /users/me` response to the signed-in user's profile, moving it to the
    // new username on a rename (the old one is unknown afterwards).
    save(saved) {
      const current = byUsername.get(me)
      const next = {
        username: saved.username ?? current.username,
        displayName: 'displayName' in saved ? saved.displayName : current.displayName,
        bio: 'bio' in saved ? saved.bio : current.bio,
        createdAt: saved.createdAt ?? current.createdAt,
      }
      byUsername.delete(me)
      me = next.username.toLowerCase()
      byUsername.set(me, next)
    },
  }
}

// Serves `GET /users/:username` from a fresh store seeded with `profiles` (404 otherwise), and
// returns that store for `mockPatch`.
function mockProfiles(profiles = { ada: ADA_PROFILE }) {
  const store = createProfileStore(profiles)
  server.use(
    http.get(apiUrl('/users/:username'), ({ params }) => {
      store.log.push(`GET /users/${params.username}`)
      const profile = store.get(params.username)
      if (!profile) return HttpResponse.json({ message: 'User not found' }, { status: 404 })
      return HttpResponse.json(profile)
    }),
  )
  return store
}

// Records every `PATCH /users/me` body. `respond(body, me)` builds the response (`me` is the
// signed-in user's stored profile); by default it echoes a successful update. A successful (2xx)
// response's saved values are applied to `store`.
function mockPatch(
  store,
  respond = (body, me) =>
    HttpResponse.json({
      id: 'u1',
      email: 'ada@example.com',
      username: body.username ?? me.username,
      displayName: 'displayName' in body ? body.displayName : me.displayName,
      bio: 'bio' in body ? body.bio || null : me.bio,
      createdAt: me.createdAt,
    }),
) {
  const requests = []
  server.use(
    http.patch(apiUrl('/users/me'), async ({ request }) => {
      const body = await request.json()
      requests.push(body)
      store.log.push('PATCH /users/me')
      const response = await respond(body, store.me())
      if (response.ok) store.save(await response.clone().json())
      return response
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
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
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
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
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
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
      const { user } = await renderEditProfile()

      await replaceText(user, 'Bio', '  New bio  ')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ bio: 'New bio' }]))
      expect(await page().findByText('New bio')).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
    })

    it('sends only the normalized username when only the username changed', async () => {
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
      const { user } = await renderEditProfile()

      await replaceText(user, 'Username', '  Ada_L ')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ username: 'ada_l' }]))
    })

    it('sends bio "" when the bio is cleared', async () => {
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
      const { user } = await renderEditProfile()

      await replaceText(user, 'Bio', '')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ bio: '' }]))
      expect(await page().findByText('No bio yet.')).toBeInTheDocument()
    })

    it.each(['ada', 'ADA'])(
      'goes to your profile without a PATCH when nothing changed (username %j)',
      async (username) => {
        const profiles = mockProfiles()
        const requests = mockPatch(profiles)
        const { user } = await renderEditProfile()

        await replaceText(user, 'Username', username)
        await save(user)

        expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
        expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
        expect(requests).toHaveLength(0)
      },
    )

    it('shows the server error when the username is taken', async () => {
      const profiles = mockProfiles()
      mockPatch(profiles, () => HttpResponse.json({ message: 'Username is already taken' }, { status: 409 }))
      const { user } = await renderEditProfile()

      await replaceText(user, 'Username', 'grace')
      await save(user)

      expect(await screen.findByRole('alert')).toHaveTextContent('Username is already taken')
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/profile')
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('disables Save and shows a spinner while saving', async () => {
      const profiles = mockProfiles()
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      mockPatch(profiles, async (body) => {
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
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
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
        displayName: null,
      })
      expect(queryClient.getQueryData(profileQueryKey('ada_l'))).toEqual({
        username: 'ada_l',
        displayName: null,
        bio: 'Renamed',
        createdAt: CREATED_AT,
      })
      // The old username's entry goes once nothing observes it: when the right rail's profile card
      // has moved to the new username too.
      await waitFor(() =>
        expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/u/ada_l'),
      )
      expect(queryClient.getQueryState(profileQueryKey('ada'))).toBeUndefined()
    })

    it("after a username change never requests the old username (it isn't re-created by a stale observer)", async () => {
      const profiles = mockProfiles()
      mockPatch(profiles)
      const { user, queryClient } = await renderEditProfile()

      await replaceText(user, 'Username', 'ada_l')
      await save(user)

      expect(await screen.findByRole('heading', { name: '@ada_l' })).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/u/ada_l'),
      )
      expect(queryClient.getQueryState(profileQueryKey('ada'))).toBeUndefined()
      const afterPatch = profiles.log.slice(profiles.log.indexOf('PATCH /users/me') + 1)
      expect(afterPatch).not.toContain('GET /users/ada')
    })
  })

  describe('name', () => {
    it('is empty for a user without a name, who can save other changes without setting one', async () => {
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
      const { user } = await renderEditProfile()

      expect(screen.getByLabelText('Name')).toHaveValue('')

      await replaceText(user, 'Bio', 'Still nameless')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ bio: 'Still nameless' }]))
      expect(await page().findByText('Still nameless')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '@ada' })).toBeInTheDocument()
    })

    it('ignores a whitespace-only name for a user without one (never sends "")', async () => {
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
      const { user } = await renderEditProfile()

      await replaceText(user, 'Name', '   ')
      await save(user)

      expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
      expect(requests).toHaveLength(0)
    })

    it('sets a name for a user without one and shows it on the profile', async () => {
      // The store keeps the saved name, so the profile page's refetch returns it too.
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
      const { user, queryClient } = await renderEditProfile()

      await replaceText(user, 'Name', '  Ada Lovelace  ')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ displayName: 'Ada Lovelace' }]))
      expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/u/ada')
      expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toMatchObject({
        username: 'ada',
        displayName: 'Ada Lovelace',
      })
      expect(queryClient.getQueryData(profileQueryKey('ada'))).toMatchObject({
        displayName: 'Ada Lovelace',
      })
    })

    it('is prefilled and can be changed', async () => {
      const profiles = mockProfiles({ ada: NAMED_ADA_PROFILE })
      const requests = mockPatch(profiles)
      const { user } = await renderEditProfile()

      expect(screen.getByLabelText('Name')).toHaveValue('Ada Lovelace')

      await replaceText(user, 'Name', 'Countess of Lovelace')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ displayName: 'Countess of Lovelace' }]))
      expect(
        await screen.findByRole('heading', { name: 'Countess of Lovelace' }),
      ).toBeInTheDocument()
    })

    it("isn't sent when unchanged", async () => {
      const profiles = mockProfiles({ ada: NAMED_ADA_PROFILE })
      const requests = mockPatch(profiles, (body) =>
        HttpResponse.json({
          id: 'u1',
          email: 'ada@example.com',
          username: 'ada',
          displayName: 'Ada Lovelace',
          bio: body.bio,
          createdAt: CREATED_AT,
        }),
      )
      const { user } = await renderEditProfile()

      await replaceText(user, 'Name', ' Ada Lovelace ')
      await replaceText(user, 'Bio', 'Poet of science')
      await save(user)

      await waitFor(() => expect(requests).toEqual([{ bio: 'Poet of science' }]))
    })

    it.each(['', '   '])("can't be cleared once set (%j)", async (value) => {
      const profiles = mockProfiles({ ada: NAMED_ADA_PROFILE })
      const requests = mockPatch(profiles)
      const { user } = await renderEditProfile()

      await replaceText(user, 'Name', value)
      await save(user)

      expect(await screen.findByText('Name is required')).toBeInTheDocument()
      const input = screen.getByLabelText('Name')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input.getAttribute('aria-describedby')).toContain('edit-profile-display-name-error')
      expect(requests).toHaveLength(0)
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/profile')
    })

    it('rejects a name longer than 50 characters', async () => {
      const profiles = mockProfiles()
      const requests = mockPatch(profiles)
      const { user } = await renderEditProfile()

      await replaceText(user, 'Name', 'a'.repeat(51))
      await save(user)

      expect(await screen.findByText('Name must be at most 50 characters')).toBeInTheDocument()
      expect(requests).toHaveLength(0)
    })
  })

  it('Cancel goes back to your own profile', async () => {
    const profiles = mockProfiles()
    const requests = mockPatch(profiles)
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
