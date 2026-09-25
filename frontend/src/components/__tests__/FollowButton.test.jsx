import { http, HttpResponse } from 'msw'
import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FollowButton } from '@/components/FollowButton'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

// Records the follow / unfollow requests as `METHOD username`.
function recordFollowRequests() {
  const requests = []
  server.use(
    http.put(apiUrl('/users/:username/follow'), ({ params }) => {
      requests.push(`PUT ${params.username}`)
      return HttpResponse.json({ following: true, followerCount: 1 })
    }),
    http.delete(apiUrl('/users/:username/follow'), ({ params }) => {
      requests.push(`DELETE ${params.username}`)
      return HttpResponse.json({ following: false, followerCount: 0 })
    }),
  )
  return requests
}

describe('FollowButton', () => {
  it('reads "Follow" when you don\'t follow them', () => {
    renderWithProviders(<FollowButton username="grace" isFollowing={false} followsYou={false} />)

    expect(screen.getByRole('button', { name: 'Follow @grace' })).toHaveTextContent(/^Follow$/)
  })

  it('reads "Follow back" when they follow you and you don\'t follow them', () => {
    renderWithProviders(<FollowButton username="grace" isFollowing={false} followsYou />)

    expect(screen.getByRole('button', { name: 'Follow back @grace' })).toHaveTextContent(
      /^Follow back$/,
    )
  })

  it('reads "Following" when you follow them, and "Unfollow" while hovered', async () => {
    const { user } = renderWithProviders(
      <FollowButton username="grace" isFollowing followsYou />,
    )

    const button = screen.getByRole('button', { name: 'Unfollow @grace' })
    expect(button).toHaveTextContent(/^Following$/)

    await user.hover(button)
    expect(button).toHaveTextContent(/^Unfollow$/)
    expect(button).toHaveClass('text-destructive')

    await user.unhover(button)
    expect(button).toHaveTextContent(/^Following$/)
    expect(button).not.toHaveClass('text-destructive')
  })

  it('reads "Unfollow" while focused with the keyboard', async () => {
    const { user } = renderWithProviders(
      <FollowButton username="grace" isFollowing followsYou={false} />,
    )
    const button = screen.getByRole('button', { name: 'Unfollow @grace' })

    await user.tab()
    expect(button).toHaveFocus()
    expect(button).toHaveTextContent(/^Unfollow$/)

    await user.tab()
    expect(button).not.toHaveFocus()
    expect(button).toHaveTextContent(/^Following$/)
  })

  it('follows with a PUT when clicked', async () => {
    const requests = recordFollowRequests()
    const { user } = renderWithProviders(
      <FollowButton username="grace" isFollowing={false} followsYou={false} />,
    )

    await user.click(screen.getByRole('button', { name: 'Follow @grace' }))

    await waitFor(() => expect(requests).toEqual(['PUT grace']))
  })

  it('unfollows with a DELETE in one click (no confirmation)', async () => {
    const requests = recordFollowRequests()
    const { user } = renderWithProviders(
      <FollowButton username="grace" isFollowing followsYou={false} />,
    )

    await user.click(screen.getByRole('button', { name: 'Unfollow @grace' }))

    await waitFor(() => expect(requests).toEqual(['DELETE grace']))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it("doesn't trigger a surrounding link or row click handler", async () => {
    const requests = recordFollowRequests()
    const onRowClick = vi.fn()
    renderWithProviders(
      <div onClick={onRowClick}>
        <a href="/u/grace">
          <FollowButton username="grace" isFollowing={false} followsYou={false} />
        </a>
      </div>,
    )
    const button = screen.getByRole('button', { name: 'Follow @grace' })

    const click = createEvent.click(button)
    fireEvent(button, click)

    await waitFor(() => expect(requests).toEqual(['PUT grace']))
    // No link navigation (default prevented) and no row click (propagation stopped).
    expect(click.defaultPrevented).toBe(true)
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
