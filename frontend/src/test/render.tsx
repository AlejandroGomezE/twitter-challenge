import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, type InitialEntry } from 'react-router'
import { createQueryClient } from '@/app/query-client'
import { AuthProvider } from '@/lib/auth/AuthProvider'

// Renders `ui` inside the same providers the app uses (src/main.tsx): QueryClient (built by the
// app's `createQueryClient`, so the central 401 handling applies) + AuthProvider, with a fresh
// QueryClient per test (no retries, no cache shared between tests) and a MemoryRouter at `route`.
// The default MSW handlers answer `GET /auth/me`, so tests render signed in.
export interface RenderWithProvidersOptions {
  // The MemoryRouter's initial entry: a URL (default '/') or a `{ pathname, search, state }`.
  route?: InitialEntry
}

export function renderWithProviders(ui: ReactNode, { route = '/' }: RenderWithProvidersOptions = {}) {
  const queryClient = createQueryClient({ queries: { retry: false, gcTime: Infinity } })

  return {
    user: userEvent.setup(),
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    ),
  }
}
