import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from '../PageHeader'

const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('PageHeader', () => {
  it('renders the title as the page h1', () => {
    render(<PageHeader title="Home" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
  })

  it('renders only the title when no optional slot is given', () => {
    const { container } = render(<PageHeader title="Home" />)

    expect(container.querySelector('p')).not.toBeInTheDocument()
    expect(container).toHaveTextContent(/^Home$/)
  })

  it('renders the subtitle, leading, trailing and children slots in order', () => {
    render(
      <PageHeader
        title="@ada"
        subtitle="0 posts"
        leading={<button type="button">Back</button>}
        trailing={<span>trailing slot</span>}
      >
        <div role="tablist" aria-label="Feed" />
      </PageHeader>,
    )

    const back = screen.getByRole('button', { name: 'Back' })
    const heading = screen.getByRole('heading', { level: 1, name: '@ada' })
    const subtitle = screen.getByText('0 posts')
    const trailing = screen.getByText('trailing slot')
    const tablist = screen.getByRole('tablist', { name: 'Feed' })

    // Title row: leading, title (+ subtitle), trailing; the children come below it.
    expect(follows(back, heading)).toBe(true)
    expect(follows(heading, subtitle)).toBe(true)
    expect(follows(subtitle, trailing)).toBe(true)
    expect(follows(trailing, tablist)).toBe(true)
  })

  it('merges a className into the outer header', () => {
    const { container } = render(<PageHeader title="Home" className="custom-header" />)

    expect(container.firstElementChild).toHaveClass('custom-header', 'sticky')
  })
})
