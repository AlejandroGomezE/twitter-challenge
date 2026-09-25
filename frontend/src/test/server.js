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
  // Profile pages load the user's posts: ada has none; other usernames are unknown (like above).
  http.get(apiUrl('/users/:username/posts'), ({ params }) =>
    params.username.toLowerCase() === 'ada'
      ? HttpResponse.json({ items: [], nextCursor: null })
      : HttpResponse.json({ message: 'User not found' }, { status: 404 }),
  ),
  // Home loads the feeds (Following and For you); empty by default.
  http.get(apiUrl('/feed'), () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get(apiUrl('/feed/for-you'), () => HttpResponse.json({ items: [], nextCursor: null })),
  // "Who to follow": nobody to suggest by default.
  http.get(apiUrl('/users/me/suggestions'), () => HttpResponse.json({ items: [] })),
  // Follow lists: ada's are empty; other usernames are unknown (like the profile above).
  ...['followers', 'following'].map((list) =>
    http.get(apiUrl(`/users/:username/${list}`), ({ params }) =>
      params.username.toLowerCase() === 'ada'
        ? HttpResponse.json({ items: [], nextCursor: null })
        : HttpResponse.json({ message: 'User not found' }, { status: 404 }),
    ),
  ),
  // Follow / unfollow succeed with a follower count of 1 / 0 by default.
  http.put(apiUrl('/users/:username/follow'), () =>
    HttpResponse.json({ following: true, followerCount: 1 }),
  ),
  http.delete(apiUrl('/users/:username/follow'), () =>
    HttpResponse.json({ following: false, followerCount: 0 }),
  ),
]

export const server = setupServer(...handlers)
