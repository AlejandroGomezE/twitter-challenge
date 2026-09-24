import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Matches `test.env.VITE_API_URL` in vite.config.js — build handler URLs with `apiUrl()`.
export const API_URL = 'http://api.test'
export const apiUrl = (path) => `${API_URL}${path}`

// Default happy-path handlers. Override per test with `server.use(...)`; overrides are reset
// after each test (src/test/setup.js). Unhandled requests fail the test.
export const handlers = [
  // Signed in by default; override with a 401 to render signed out.
  http.get(apiUrl('/auth/me'), () =>
    HttpResponse.json({ id: 'u1', email: 'ada@example.com', username: 'ada' }),
  ),
  // The signed-in app shell loads ada's profile (right rail card); other usernames are unknown.
  http.get(apiUrl('/users/:username'), ({ params }) =>
    params.username.toLowerCase() === 'ada'
      ? HttpResponse.json({ username: 'ada', bio: null, createdAt: '2026-09-15T12:00:00.000Z' })
      : HttpResponse.json({ message: 'User not found' }, { status: 404 }),
  ),
]

export const server = setupServer(...handlers)
