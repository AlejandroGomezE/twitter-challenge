import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'
import { Home } from '../Home'

// The AppShell provides the TooltipProvider the "Coming soon" tab needs.
const renderHome = () =>
  renderWithProviders(
    <TooltipProvider>
      <Home />
    </TooltipProvider>,
  )

describe('Home', () => {
  it('shows the "Home" header with For you selected and Following coming soon', () => {
    renderHome()

    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(screen.getByText('created by Alejandro Gomez')).toBeInTheDocument()

    const tablist = screen.getByRole('tablist', { name: 'Feed' })
    const forYou = within(tablist).getByRole('tab', { name: 'For you' })
    const following = within(tablist).getByRole('tab', { name: 'Following' })
    expect(forYou).toHaveAttribute('aria-selected', 'true')
    expect(following).toHaveAttribute('aria-selected', 'false')
    expect(following).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('tabpanel', { name: 'For you' })).toBeInTheDocument()
  })

  // fireEvent (no focus/pointer move) so the Radix tooltip, which needs ResizeObserver, stays shut.
  it('makes Following an aria-disabled tab whose activation is prevented', () => {
    renderHome()
    const following = screen.getByRole('tab', { name: 'Following' })

    expect(following).toHaveAttribute('aria-disabled', 'true')
    expect(following).not.toHaveAttribute('aria-controls')
    // fireEvent returns false when a handler called preventDefault() (ComingSoon's guard).
    expect(fireEvent.click(following)).toBe(false)
    expect(following).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: 'For you' })).toBeInTheDocument()
  })

  it('shows a disabled composer with a visible "Posting is coming soon" hint', async () => {
    renderHome()

    expect(await screen.findByRole('img', { name: '@ada' })).toBeInTheDocument()

    const textarea = screen.getByRole('textbox', { name: 'Compose a new post' })
    expect(textarea).toBeDisabled()
    expect(textarea).toHaveAttribute('aria-disabled', 'true')
    expect(textarea).toHaveAccessibleDescription('Posting is coming soon')
    expect(screen.getByText('Posting is coming soon')).toBeVisible()

    expect(screen.getByText('0/280')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    for (const name of ['Add an image', 'Add an emoji', 'Schedule post', 'Add a location']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('shows the empty state instead of posts', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: 'No posts yet' })).toBeInTheDocument()
    expect(
      screen.getByText('When posting arrives, the latest posts will show up here.'),
    ).toBeInTheDocument()
  })
})
