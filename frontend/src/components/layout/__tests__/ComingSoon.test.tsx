import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ComingSoon } from '../ComingSoon'

// jsdom has no ResizeObserver, so the Radix tooltip can't open: these tests use fireEvent (no
// focus/pointer move) and assert the trigger wiring rather than the tooltip text.
function renderComingSoon(child = <button type="button">Explore</button>) {
  return render(
    <TooltipProvider>
      <ComingSoon>{child}</ComingSoon>
    </TooltipProvider>,
  )
}

function LocationDisplay() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

// A native button turns Enter (keydown) / Space (keyup) into a click; jsdom doesn't synthesize
// it, so dispatch the key and then the click the browser would fire.
const pressKeyAndClick = (element: Element, key: string, code: string) => {
  fireEvent.keyDown(element, { key, code })
  fireEvent.keyUp(element, { key, code })
  return fireEvent.click(element)
}

describe('ComingSoon', () => {
  it('marks the wrapped button aria-disabled but keeps it focusable (not `disabled`)', () => {
    renderComingSoon()

    const button = screen.getByRole('button', { name: 'Explore' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).not.toHaveAttribute('tabindex', '-1')
    expect(button).toHaveClass('cursor-not-allowed', 'opacity-50')
  })

  it('renders the child itself: a button, never a link', () => {
    renderComingSoon()

    const button = screen.getByRole('button', { name: 'Explore' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).not.toHaveAttribute('href')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('prevents the default action of a click, including the one Enter/Space produce', () => {
    renderComingSoon()
    const button = screen.getByRole('button', { name: 'Explore' })

    // fireEvent returns false when a handler called preventDefault().
    expect(fireEvent.click(button)).toBe(false)
    expect(pressKeyAndClick(button, 'Enter', 'Enter')).toBe(false)
    expect(pressKeyAndClick(button, ' ', 'Space')).toBe(false)
  })

  it('does not fire a surrounding form submit handler on click, Enter or Space', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(
      <TooltipProvider>
        <form onSubmit={onSubmit}>
          <ComingSoon>
            <button type="submit">New post</button>
          </ComingSoon>
        </form>
      </TooltipProvider>,
    )
    const button = screen.getByRole('button', { name: 'New post' })

    fireEvent.click(button)
    pressKeyAndClick(button, 'Enter', 'Enter')
    pressKeyAndClick(button, ' ', 'Space')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not navigate', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TooltipProvider>
          <ComingSoon>
            <button type="button">Explore</button>
          </ComingSoon>
        </TooltipProvider>
        <LocationDisplay />
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: 'Explore' })

    fireEvent.click(button)
    pressKeyAndClick(button, 'Enter', 'Enter')

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  it('wires the element as a (closed) "Coming soon" tooltip trigger', () => {
    renderComingSoon()

    const button = screen.getByRole('button', { name: 'Explore' })
    expect(button).toHaveAttribute('data-slot', 'tooltip-trigger')
    expect(button).toHaveAttribute('data-state', 'closed')
    // Radix only renders the content and points aria-describedby at it while the tooltip is
    // open (hover/focus), which jsdom can't do.
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
  })

  it('also wraps a read-only input', () => {
    renderComingSoon(<input type="search" readOnly aria-label="Search" />)

    const input = screen.getByRole('searchbox', { name: 'Search' })
    expect(input).toHaveAttribute('aria-disabled', 'true')
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('data-slot', 'tooltip-trigger')
  })
})
