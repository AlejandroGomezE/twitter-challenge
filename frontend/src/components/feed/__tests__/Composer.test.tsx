import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { Composer } from '../Composer'

const ATTACHMENT_LABELS = ['Add an image', 'Add an emoji', 'Schedule post', 'Add a location']
const EMOJI = '\u{1F600}'

// The avatar appears once /auth/me resolves; wait for it so the rest runs signed in. The
// attachment icons are ComingSoon placeholders, which need a TooltipProvider (AppShell has one).
async function renderComposer() {
  const utils = renderWithProviders(
    <TooltipProvider>
      <Composer />
    </TooltipProvider>,
  )
  await screen.findByRole('img', { name: '@ada' })
  return utils
}

const createdPost = (body: string) => ({
  id: 'p1',
  body,
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'ada' },
  likeCount: 0,
  commentCount: 0,
  likedByMe: false,
})

// `POST /posts`: records each request body and answers with `respond(body)` (default: 201 + the
// created post), after `gate` resolves when one is given.
interface MockCreatePostOptions {
  respond?: (body: string) => Response
  gate?: Promise<void>
}

function mockCreatePost({ respond, gate }: MockCreatePostOptions = {}) {
  const bodies: string[] = []
  server.use(
    http.post<never, { body: string }>(apiUrl('/posts'), async ({ request }) => {
      const { body } = await request.json()
      bodies.push(body)
      if (gate) await gate
      return respond ? respond(body) : HttpResponse.json(createdPost(body), { status: 201 })
    }),
  )
  return bodies
}

const textbox = () => screen.getByRole('textbox', { name: 'Compose a new post' })
const postButton = () => screen.getByRole('button', { name: 'Post' })

describe('Composer', () => {
  it("shows the signed-in user's avatar", async () => {
    await renderComposer()

    expect(screen.getByRole('img', { name: '@ada' })).toBeInTheDocument()
  })

  it('has an enabled textarea (id="composer") described by the 0/280 counter', async () => {
    await renderComposer()

    const textarea = textbox()
    expect(textarea).toBeEnabled()
    expect(textarea).toHaveAttribute('id', 'composer')
    expect(textarea).toHaveAccessibleDescription('0/280')
    expect(screen.queryByText('Posting is coming soon')).not.toBeInTheDocument()
  })

  it('shows a disabled Post button and "Coming soon" (aria-disabled) attachment buttons', async () => {
    await renderComposer()

    expect(postButton()).toBeDisabled()
    for (const name of ATTACHMENT_LABELS) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    expect(screen.getAllByRole('button')).toHaveLength(ATTACHMENT_LABELS.length + 1)
  })

  it('counts typed text and enables Post', async () => {
    const { user } = await renderComposer()

    await user.type(textbox(), 'Hello flock')

    expect(textbox()).toHaveValue('Hello flock')
    expect(screen.getByText('11/280')).toBeInTheDocument()
    expect(postButton()).toBeEnabled()
  })

  describe('submitting', () => {
    it('posts the trimmed text and clears the textarea on success', async () => {
      const bodies = mockCreatePost()
      const { user } = await renderComposer()

      await user.type(textbox(), '  Hello flock  ')
      await user.click(postButton())

      await waitFor(() => expect(textbox()).toHaveValue(''))
      expect(bodies).toEqual(['Hello flock'])
      expect(screen.getByText('0/280')).toBeInTheDocument()
      expect(postButton()).toBeDisabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows a 400 validation message array joined, and keeps the text', async () => {
      mockCreatePost({
        respond: () =>
          HttpResponse.json(
            { message: ['body must not be blank', 'body is too long'] },
            { status: 400 },
          ),
      })
      const { user } = await renderComposer()

      await user.type(textbox(), 'Hello flock')
      await user.click(postButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'body must not be blank. body is too long',
      )
      expect(textbox()).toHaveValue('Hello flock')
      expect(postButton()).toBeEnabled()
    })

    it('shows "Too many posts…" on a 429 and keeps the text', async () => {
      mockCreatePost({
        respond: () =>
          HttpResponse.json({ message: 'ThrottlerException: Too Many Requests' }, { status: 429 }),
      })
      const { user } = await renderComposer()

      await user.type(textbox(), 'Hello flock')
      await user.click(postButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many posts. Try again in a minute.',
      )
      expect(textbox()).toHaveValue('Hello flock')
    })

    it('clears the error once the text is edited', async () => {
      mockCreatePost({
        respond: () => HttpResponse.json({ message: 'Nope' }, { status: 400 }),
      })
      const { user } = await renderComposer()

      await user.type(textbox(), 'Hello flock')
      await user.click(postButton())
      expect(await screen.findByRole('alert')).toHaveTextContent('Nope')

      await user.type(textbox(), '!')

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(textbox()).toHaveValue('Hello flock!')
    })

    it.each([
      ['Ctrl', '{Control>}{Enter}{/Control}'],
      ['Cmd', '{Meta>}{Enter}{/Meta}'],
    ])('submits with %s+Enter', async (_label, keys) => {
      const bodies = mockCreatePost()
      const { user } = await renderComposer()

      await user.type(textbox(), 'Hello flock')
      await user.keyboard(keys)

      await waitFor(() => expect(textbox()).toHaveValue(''))
      expect(bodies).toEqual(['Hello flock'])
    })

    it('ignores Ctrl+Enter while an IME is composing, and plain Enter', async () => {
      const bodies = mockCreatePost()
      const { user } = await renderComposer()
      await user.type(textbox(), 'Hello flock')

      fireEvent.keyDown(textbox(), { key: 'Enter', ctrlKey: true, isComposing: true })
      fireEvent.keyDown(textbox(), { key: 'Enter', ctrlKey: true, keyCode: 229 })
      fireEvent.keyDown(textbox(), { key: 'Enter' })

      // Nothing was submitted: the textarea isn't read-only (pending) and nothing reached the API.
      await user.type(textbox(), '!')
      expect(textbox()).toHaveValue('Hello flock!')
      expect(bodies).toEqual([])

      // A real Ctrl+Enter afterwards is the only request.
      await user.keyboard('{Control>}{Enter}{/Control}')
      await waitFor(() => expect(textbox()).toHaveValue(''))
      expect(bodies).toEqual(['Hello flock!'])
    })

    it("doesn't submit twice while a post is pending, and shows a spinner", async () => {
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const bodies = mockCreatePost({ gate })
      const { user } = await renderComposer()

      await user.type(textbox(), 'Hello flock')
      await user.click(postButton())

      await waitFor(() => expect(postButton()).toBeDisabled())
      expect(postButton().querySelector('[data-slot="spinner"]')).toBeInTheDocument()
      expect(textbox()).toHaveAttribute('readonly')
      fireEvent.keyDown(textbox(), { key: 'Enter', ctrlKey: true })
      fireEvent.click(postButton())
      fireEvent.submit(textbox().closest('form')!)

      release!()
      await waitFor(() => expect(textbox()).toHaveValue(''))
      expect(bodies).toEqual(['Hello flock'])
      expect(textbox()).not.toHaveAttribute('readonly')
    })
  })

  describe('validation', () => {
    it('keeps Post disabled for whitespace-only text', async () => {
      const { user } = await renderComposer()

      await user.type(textbox(), '   {Enter}  ')

      expect(postButton()).toBeDisabled()
      expect(screen.getByText('0/280')).toBeInTheDocument()
    })

    it('counts an emoji as one character', async () => {
      const { user } = await renderComposer()

      await user.click(textbox())
      await user.paste(EMOJI.repeat(280))

      expect(screen.getByText('280/280')).toBeInTheDocument()
      expect(postButton()).toBeEnabled()
      expect(textbox()).not.toHaveAttribute('aria-invalid')
    })

    it('marks text over 280 code points: destructive counter, aria-invalid, Post disabled', async () => {
      const { user } = await renderComposer()

      await user.click(textbox())
      await user.paste(`${EMOJI.repeat(280)}a`)

      expect(screen.getByText('281/280')).toHaveClass('text-destructive')
      expect(textbox()).toHaveAttribute('aria-invalid', 'true')
      expect(postButton()).toBeDisabled()
      expect(screen.getByText('1 character over the limit')).toBeInTheDocument()
    })
  })
})
