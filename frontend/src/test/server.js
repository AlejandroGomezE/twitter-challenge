import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Matches `test.env.VITE_API_URL` in vite.config.js — build handler URLs with `apiUrl()`.
export const API_URL = 'http://api.test'
export const apiUrl = (path) => `${API_URL}${path}`

// Default happy-path handlers. Override per test with `server.use(...)`; overrides are reset
// after each test (src/test/setup.js). Unhandled requests fail the test.
export const handlers = [http.get(apiUrl('/'), () => HttpResponse.json({ message: 'Hello World!' }))]

export const server = setupServer(...handlers)
