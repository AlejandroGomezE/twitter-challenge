import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandMark } from '../BrandMark'

describe('BrandMark', () => {
  it('is decorative: hidden from assistive tech, with no text', () => {
    const { container } = render(<BrandMark />)

    const mark = container.firstElementChild
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark.querySelector('svg')).toBeInTheDocument()
    expect(mark).toHaveTextContent('')
  })

  it('merges className into the mark and iconClassName into the icon', () => {
    const { container } = render(<BrandMark className="size-10" iconClassName="size-6" />)

    const mark = container.firstElementChild
    expect(mark).toHaveClass('size-10', 'bg-primary')
    expect(mark).not.toHaveClass('size-9')
    expect(mark.querySelector('svg')).toHaveClass('size-6')
  })
})
