import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { Composer } from '../Composer'

const ATTACHMENT_LABELS = ['Add an image', 'Add an emoji', 'Schedule post', 'Add a location']

// The avatar appears once /auth/me resolves; wait for it so the rest runs signed in.
async function renderComposer() {
  const utils = renderWithProviders(<Composer />)
  await screen.findByRole('img', { name: '@ada' })
  return utils
}

describe('Composer', () => {
  it("shows the signed-in user's avatar", async () => {
    await renderComposer()

    expect(screen.getByRole('img', { name: '@ada' })).toBeInTheDocument()
  })

  it('disables the textarea and describes it with the visible "Posting is coming soon" hint', async () => {
    await renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Compose a new post' })
    expect(textarea).toBeDisabled()
    expect(textarea).toHaveAttribute('aria-disabled', 'true')
    expect(textarea).toHaveAttribute('maxlength', '280')
    expect(textarea).toHaveAccessibleDescription('Posting is coming soon')
    expect(screen.getByText('Posting is coming soon')).toBeVisible()
  })

  it('shows a 0/280 counter, a disabled Post button and disabled, labelled attachment buttons', async () => {
    await renderComposer()

    expect(screen.getByText('0/280')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    for (const name of ATTACHMENT_LABELS) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getAllByRole('button')).toHaveLength(ATTACHMENT_LABELS.length + 1)
  })

  it('ignores typing', async () => {
    const { user } = await renderComposer()
    const textarea = screen.getByRole('textbox', { name: 'Compose a new post' })

    await user.type(textarea, 'Hello flock')

    expect(textarea).toHaveValue('')
    expect(screen.getByText('0/280')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })
})
