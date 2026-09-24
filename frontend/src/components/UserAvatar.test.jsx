import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getAvatarColor } from '@/lib/avatar-color'
import { UserAvatar } from './UserAvatar'

const bgClassOf = (element) => [...element.classList].find((cls) => cls.startsWith('bg-'))

describe('UserAvatar', () => {
  it('renders the uppercased initial', () => {
    render(<UserAvatar username="ada" />)

    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('exposes an image named @username with the letter hidden from assistive tech', () => {
    render(<UserAvatar username="ada" />)

    const avatar = screen.getByRole('img', { name: '@ada' })
    expect(avatar).toBeInTheDocument()
    expect(screen.getByText('A')).toHaveAttribute('aria-hidden', 'true')
    expect(avatar).toContainElement(screen.getByText('A'))
  })

  it('uses the same colour for the same user', () => {
    render(
      <>
        <UserAvatar username="ada" />
        <UserAvatar username="ADA" />
      </>,
    )

    const [first, second] = screen.getAllByText('A')
    expect(bgClassOf(first)).toBeDefined()
    expect(bgClassOf(first)).toBe(bgClassOf(second))
    for (const cls of getAvatarColor('ada').split(' ')) {
      expect(first).toHaveClass(cls)
    }
  })

  it('defaults the size and passes size / className / fallbackClassName through', () => {
    const { rerender } = render(<UserAvatar username="ada" />)

    expect(screen.getByRole('img', { name: '@ada' })).toHaveAttribute('data-size', 'default')

    rerender(<UserAvatar username="ada" size="lg" className="size-20" fallbackClassName="text-3xl" />)

    const avatar = screen.getByRole('img', { name: '@ada' })
    expect(avatar).toHaveAttribute('data-size', 'lg')
    expect(avatar).toHaveClass('size-20')
    expect(screen.getByText('A')).toHaveClass('text-3xl')
  })
})
