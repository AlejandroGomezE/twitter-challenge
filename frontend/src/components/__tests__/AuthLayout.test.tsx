import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthLayout } from '../AuthLayout'

describe('AuthLayout', () => {
  let original: string

  beforeEach(() => {
    original = document.title
    document.title = 'Before'
  })

  afterEach(() => {
    document.title = original
  })

  it('renders the brand (decorative mark + name) and its children', () => {
    const { container } = render(
      <AuthLayout title="Sign in">
        <h1>Sign in</h1>
      </AuthLayout>,
    )

    expect(screen.getByText('The Flock Twitter')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"] svg')).toBeInTheDocument()
  })

  it('sets the document title while mounted and restores the previous one on unmount', () => {
    const { unmount } = render(<AuthLayout title="Sign in">content</AuthLayout>)

    expect(document.title).toBe('Sign in · The Flock Twitter')

    unmount()

    expect(document.title).toBe('Before')
  })

  it('follows a title change and still restores the original title', () => {
    const { rerender, unmount } = render(<AuthLayout title="Sign in">content</AuthLayout>)

    rerender(<AuthLayout title="Create an account">content</AuthLayout>)
    expect(document.title).toBe('Create an account · The Flock Twitter')

    unmount()
    expect(document.title).toBe('Before')
  })

  it('restores the original title after switching from one AuthLayout to another', () => {
    const { rerender, unmount } = render(
      <AuthLayout key="sign-in" title="Sign in">
        content
      </AuthLayout>,
    )

    rerender(
      <AuthLayout key="sign-up" title="Create an account">
        content
      </AuthLayout>,
    )
    expect(document.title).toBe('Create an account · The Flock Twitter')

    unmount()
    expect(document.title).toBe('Before')
  })

  it('merges className into the content column', () => {
    render(
      <AuthLayout title="Sign in" className="gap-4">
        <p>child</p>
      </AuthLayout>,
    )

    expect(screen.getByText('child').parentElement).toHaveClass('gap-4', 'max-w-sm')
  })
})
