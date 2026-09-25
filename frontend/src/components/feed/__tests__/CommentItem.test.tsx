import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { Comment } from '@/lib/api/types'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { CommentItem, type CommentItemProps } from '../CommentItem'

// PostDetail's tests cover the comment list (order, timestamp, delete success/cancel, no menu on
// others' comments); these cover CommentItem on its own. The default MSW handlers sign in as `ada`.
const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: 'c1',
  body: 'nice post',
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'grace', displayName: null },
  ...overrides,
})

const renderItem = (comment: Comment, props: Partial<CommentItemProps> = {}) =>
  renderWithProviders(<CommentItem comment={comment} postId="p1" {...props} />)

const item = () => screen.getByRole('article')

async function openDeleteDialog(user: UserEvent) {
  await user.click(await within(item()).findByRole('button', { name: 'More options' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  return screen.findByRole('alertdialog', { name: 'Delete comment?' })
}

describe('CommentItem', () => {
  it('shows the display name (bold) before the muted @username, in the profile link', () => {
    renderItem(makeComment({ author: { username: 'grace', displayName: 'Grace Hopper' } }))

    const link = within(item()).getByRole('link', { name: 'Grace Hopper @grace' })
    expect(link).toHaveAttribute('href', '/u/grace')
    expect(within(link).getByText('Grace Hopper')).toHaveClass('font-semibold')
    expect(within(link).getByText('@grace')).toHaveClass('text-muted-foreground')
  })

  it('shows only @username when the author has no display name', () => {
    renderItem(makeComment())

    const link = within(item()).getByRole('link', { name: '@grace' })
    expect(link).toHaveAttribute('href', '/u/grace')
    expect(link).toHaveTextContent(/^@grace$/)
    expect(within(link).getByText('@grace')).toHaveClass('font-mono', 'font-semibold')
  })

  it('renders the body as plain text, keeping line breaks', () => {
    renderItem(makeComment({ body: '<b>not bold</b>\nsecond line' }))

    const body = within(item()).getByText(/not bold/)
    expect(body.textContent).toBe('<b>not bold</b>\nsecond line')
    expect(body.querySelector('b')).toBeNull()
    expect(body).toHaveClass('whitespace-pre-wrap')
  })

  it('treats a comment as your own regardless of username case', async () => {
    renderItem(makeComment({ author: { username: 'ADA', displayName: null } }))

    expect(await within(item()).findByRole('button', { name: 'More options' })).toBeInTheDocument()
  })

  it('calls onDeleted with the comment id once the delete succeeds', async () => {
    let deleted
    server.use(
      http.delete(apiUrl('/posts/:id/comments/:commentId'), ({ params }) => {
        deleted = `${params.id}/${params.commentId}`
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const onDeleted = vi.fn()
    const { user } = renderItem(makeComment({ author: { username: 'ada', displayName: null } }), {
      onDeleted,
    })

    const dialog = await openDeleteDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('c1'))
    expect(deleted).toBe('p1/c1')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it("keeps the dialog open and shows the server's error when the delete fails", async () => {
    server.use(
      http.delete(apiUrl('/posts/:id/comments/:commentId'), () =>
        HttpResponse.json({ message: 'Comment not found' }, { status: 404 }),
      ),
    )
    const onDeleted = vi.fn()
    const { user } = renderItem(makeComment({ author: { username: 'ada', displayName: null } }), {
      onDeleted,
    })

    const dialog = await openDeleteDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Comment not found')
    expect(screen.getByRole('alertdialog', { name: 'Delete comment?' })).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()

    // Closing and reopening clears the stale error.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const reopened = await openDeleteDialog(user)
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
  })
})
