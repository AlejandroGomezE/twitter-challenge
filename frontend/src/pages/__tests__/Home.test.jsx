import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { Home } from '../Home'

describe('Home', () => {
  it('shows the signed-in user and a Sign out link to /sign-out', async () => {
    renderWithProviders(<Home />)

    expect(await screen.findByText('Signed in as ada@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/sign-out')
  })

  it("links to the signed-in user's profile", async () => {
    renderWithProviders(<Home />)

    expect(await screen.findByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/u/ada')
  })
})
