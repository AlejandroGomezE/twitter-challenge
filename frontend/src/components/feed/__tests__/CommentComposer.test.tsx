import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { CommentComposer } from '../CommentComposer'

const EMOJI = '\u{1F600}'

// The avatar appears once /auth/me resolves; wait for it so the rest runs signed in.
async function renderComposer() {
  const utils = renderWithProviders(<CommentComposer postId="p1" />)
  await screen.findByRole('img', { name: '@ada' })
  return utils
}

// `POST /posts/p1/comments`: records each request body and answers with `respond(body)` (default:
// 201 + the created comment).
function mockCreateComment(respond?: (body: string) => Response) {
  const bodies: string[] = []
  server.use(
    http.post<never, { body: string }>(apiUrl('/posts/p1/comments'), async ({ request }) => {
      const { body } = await request.json()
      bodies.push(body)
      return respond
        ? respond(body)
        : HttpResponse.json(
            { id: 'c1', body, createdAt: '2026-09-24T12:00:00.000Z', author: { username: 'ada' } },
            { status: 201 },
          )
    }),
  )
  return bodies
}

const textbox = () => screen.getByRole('textbox', { name: 'Post your reply' })
const replyButton = () => screen.getByRole('button', { name: 'Reply' })

describe('CommentComposer', () => {
  it("shows the signed-in user's avatar, an empty reply box described by 0/280 and a disabled Reply", async () => {
    await renderComposer()

    expect(textbox()).toHaveAttribute('placeholder', 'Post your reply')
    expect(textbox()).toHaveAccessibleDescription('0/280')
    expect(replyButton()).toBeDisabled()
  })

  it('sends the trimmed text and clears the box on success', async () => {
    const bodies = mockCreateComment()
    const { user } = await renderComposer()

    await user.type(textbox(), '  Nice one  ')
    expect(screen.getByText('8/280')).toBeInTheDocument()
    await user.click(replyButton())

    await waitFor(() => expect(textbox()).toHaveValue(''))
    expect(bodies).toEqual(['Nice one'])
    expect(replyButton()).toBeDisabled()
  })

  it('sends with Ctrl+Enter but not while an IME is composing', async () => {
    const bodies = mockCreateComment()
    const { user } = await renderComposer()
    await user.type(textbox(), 'Nice one')

    fireEvent.keyDown(textbox(), { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.keyDown(textbox(), { key: 'Enter', ctrlKey: true, keyCode: 229 })
    expect(bodies).toEqual([])

    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(textbox()).toHaveValue(''))
    expect(bodies).toEqual(['Nice one'])
  })

  describe('validation', () => {
    it('keeps Reply disabled for whitespace-only text', async () => {
      const bodies = mockCreateComment()
      const { user } = await renderComposer()

      await user.type(textbox(), '   ')
      await user.keyboard('{Control>}{Enter}{/Control}')

      expect(replyButton()).toBeDisabled()
      expect(screen.getByText('0/280')).toBeInTheDocument()
      expect(bodies).toEqual([])
    })

    it('marks text over 280 code points and keeps Reply disabled', async () => {
      const { user } = await renderComposer()

      await user.click(textbox())
      await user.paste(`${EMOJI.repeat(280)}a`)

      expect(screen.getByText('281/280')).toHaveClass('text-destructive')
      expect(textbox()).toHaveAttribute('aria-invalid', 'true')
      expect(replyButton()).toBeDisabled()
      expect(screen.getByText('1 character over the limit')).toBeInTheDocument()
    })

    it('accepts exactly 280 emoji (one code point each)', async () => {
      const { user } = await renderComposer()

      await user.click(textbox())
      await user.paste(EMOJI.repeat(280))

      expect(screen.getByText('280/280')).toBeInTheDocument()
      expect(replyButton()).toBeEnabled()
    })
  })

  describe('server errors', () => {
    it('shows "Too many comments…" on a 429 and keeps the text', async () => {
      mockCreateComment(() =>
        HttpResponse.json({ message: 'ThrottlerException: Too Many Requests' }, { status: 429 }),
      )
      const { user } = await renderComposer()

      await user.type(textbox(), 'Nice one')
      await user.click(replyButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many comments. Try again in a minute.',
      )
      expect(textbox()).toHaveValue('Nice one')
    })

    it('joins a 400 message array, and clears it once the text is edited', async () => {
      mockCreateComment(() =>
        HttpResponse.json({ message: ['body must not be blank', 'body is too long'] }, { status: 400 }),
      )
      const { user } = await renderComposer()

      await user.type(textbox(), 'Nice one')
      await user.click(replyButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'body must not be blank. body is too long',
      )
      await user.type(textbox(), '!')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
