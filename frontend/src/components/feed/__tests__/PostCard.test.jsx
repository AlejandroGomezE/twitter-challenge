import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useFeed } from '@/hooks/use-posts'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'
import { PostCard } from '../PostCard'

const post = (overrides = {}) => ({
  id: 'p1',
  body: 'hello flock',
  createdAt: '2026-09-24T12:00:00.000Z',
  author: { username: 'ada' },
  likeCount: 2,
  commentCount: 1,
  likedByMe: false,
  ...overrides,
})

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

// The card renders from the feed cache, the way Home does, so like updates show up.
function FeedCard() {
  const feed = useFeed()
  const first = feed.data?.pages[0].items[0]
  return first ? <PostCard post={first} /> : null
}

async function renderCard(overrides) {
  server.use(
    http.get(apiUrl('/feed'), () => HttpResponse.json({ items: [post(overrides)], nextCursor: null })),
  )
  const view = renderWithProviders(
    <TooltipProvider>
      <FeedCard />
      <Location />
    </TooltipProvider>,
  )
  await screen.findByRole('article')
  return view
}

const likeResponse = { liked: true, likeCount: 3 }
const mockLike = () =>
  server.use(http.put(apiUrl('/posts/:id/like'), () => HttpResponse.json(likeResponse)))

const location = () => screen.getByTestId('location')
const card = () => screen.getByRole('article')

describe('PostCard', () => {
  it('shows the author, body, counts and a link to the post', async () => {
    await renderCard()

    expect(within(card()).getByRole('link', { name: '@ada' })).toHaveAttribute('href', '/u/ada')
    expect(within(card()).getByText('hello flock')).toBeInTheDocument()
    expect(within(card()).getByRole('link', { name: /Open post by @ada/ })).toHaveAttribute(
      'href',
      '/u/ada/posts/p1',
    )
    expect(within(card()).getByRole('button', { name: /2 likes/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('shows the author display name before the muted @username, in the same profile link', async () => {
    await renderCard({ author: { username: 'ada', displayName: 'Ada Lovelace' } })

    const link = within(card()).getByRole('link', { name: 'Ada Lovelace @ada' })
    expect(link).toHaveAttribute('href', '/u/ada')
    expect(within(link).getByText('Ada Lovelace')).toHaveClass('font-semibold')
    expect(within(link).getByText('@ada')).toHaveClass('text-muted-foreground')
    // The timestamp link keeps its accessible name.
    expect(within(card()).getByRole('link', { name: /Open post by @ada/ })).toBeInTheDocument()
  })

  it('opens the post when the card body is clicked', async () => {
    const { user } = await renderCard()

    await user.click(within(card()).getByText('hello flock'))
    expect(location()).toHaveTextContent('/u/ada/posts/p1')
  })

  it('likes without opening the post, updating the button state and count', async () => {
    mockLike()
    const { user } = await renderCard()

    await user.click(within(card()).getByRole('button', { name: /2 likes/ }))
    expect(await within(card()).findByRole('button', { name: /3 likes/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(location()).toHaveTextContent(/^\/$/)
  })

  it('gives your own post a "More options" menu with Delete, without opening the post', async () => {
    const { user } = await renderCard()

    await user.click(within(card()).getByRole('button', { name: 'More options' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(location()).toHaveTextContent(/^\/$/)
  })

  it("gives someone else's post no menu", async () => {
    await renderCard({ author: { username: 'grace' } })

    expect(within(card()).queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
  })
})
