import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserName } from '../UserName'

describe('UserName', () => {
  it('shows the display name, then the muted @username', () => {
    render(
      <a href="/u/ada">
        <UserName username="ada" displayName="Ada Lovelace" />
      </a>,
    )

    const name = screen.getByText('Ada Lovelace')
    const handle = screen.getByText('@ada')
    expect(name).toHaveClass('font-semibold', 'text-foreground', 'truncate', 'min-w-0')
    expect(handle).toHaveClass('text-muted-foreground', 'font-mono')
    // The name comes first and both are read together.
    expect(name.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ada Lovelace @ada' })).toBeInTheDocument()
  })

  it('lets the display name truncate first while keeping @username visible', () => {
    render(<UserName username="ada" displayName={'A'.repeat(50)} />)

    expect(screen.getByText('A'.repeat(50))).toHaveClass('truncate', 'min-w-0')
    expect(screen.getByText('@ada')).toHaveClass('shrink-0', 'truncate')
  })

  it.each([null, undefined, ''])(
    'shows only @username, styled as before, without a display name (%j)',
    (displayName) => {
      render(
        <a href="/u/ada">
          <UserName username="ada" displayName={displayName} />
        </a>,
      )

      const handle = screen.getByText('@ada')
      expect(handle).toHaveClass('font-mono', 'font-semibold', 'text-foreground', 'truncate')
      expect(screen.getByRole('link', { name: '@ada' })).toHaveTextContent(/^@ada$/)
    },
  )

  it('uses the caller fallback styling for @username alone', () => {
    render(
      <UserName
        username="ada"
        displayName={null}
        fallbackClassName="font-mono text-muted-foreground"
      />,
    )

    const handle = screen.getByText('@ada')
    expect(handle).toHaveClass('font-mono', 'text-muted-foreground')
    expect(handle).not.toHaveClass('font-semibold')
  })

  it('stacks @username under the name when asked', () => {
    render(<UserName username="ada" displayName="Ada Lovelace" stacked nameClassName="text-xl" />)

    const root = screen.getByText('Ada Lovelace').parentElement
    expect(root).toHaveClass('flex-col')
    expect(screen.getByText('Ada Lovelace')).toHaveClass('text-xl')
    expect(screen.getByText('@ada')).not.toHaveClass('shrink-0')
  })
})
