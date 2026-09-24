import { http, HttpResponse } from 'msw'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { Home } from './Home'

describe('Home', () => {
  it('shows a loading state, then the backend message', async () => {
    renderWithProviders(<Home />)

    expect(screen.getByText('Checking backend…')).toBeInTheDocument()
    expect(await screen.findByText('Hello World!')).toBeInTheDocument()
    expect(screen.queryByText('Checking backend…')).not.toBeInTheDocument()
  })

  it('shows the signed-in user and a Sign out link to /sign-out', async () => {
    renderWithProviders(<Home />)

    expect(await screen.findByText('Signed in as ada@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/sign-out')
  })

  it('shows an error when the backend fails', async () => {
    server.use(http.get(apiUrl('/'), () => HttpResponse.json({ message: 'Down' }, { status: 503 })))

    renderWithProviders(<Home />)

    expect(await screen.findByText('Backend unreachable: Down')).toBeInTheDocument()
  })
})
