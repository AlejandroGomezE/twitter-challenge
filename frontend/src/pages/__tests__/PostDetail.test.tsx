import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse, type DefaultBodyType } from 'msw'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router'
import type { Comment, Post } from '@/lib/api/types'
import { renderWithProviders } from '@/test/render'
import { apiUrl, server } from '@/test/server'

const CREATED_AT = '2026-09-24T12:00:00.000Z'

const makePost = (overrides: Partial<Post> = {}): Post => ({
  id: 'p1',
  body: 'Hello from the detail page',
  createdAt: CREATED_AT,
  author: { username: 'ada', displayName: null },
  likeCount: 0,
  commentCount: 0,
  likedByMe: false,
  ...overrides,
})

const makeComment = (id: string, overrides: Partial<Comment> = {}): Comment => ({
  id,
  body: `comment ${id}`,
  createdAt: CREATED_AT,
  author: { username: 'ada', displayName: null },
  ...overrides,
})

function LocationDisplay() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

// Renders the whole app at `route` and waits for the shell (it appears once /auth/me resolves).
async function renderApp(route: string) {
  const utils = renderWithProviders(
    <>
      <AppRouter />
      <LocationDisplay />
    </>,
    { route },
  )
  await screen.findByRole('main')
  return utils
}

// A small fake backend for one post and its comments. `state.post` is the post (null = deleted /
// unknown → 404), `state.comments` its comments (oldest first; `pages` splits them into pages of
// that size), `state.postStatus` / `state.commentsStatus` force an error status, and
// `state.createComment` overrides the POST response. Writes keep `commentCount` in sync.
interface MockPostApiOptions {
  post?: Post | null
  comments?: Comment[]
  pageSize?: number
}

interface MockPostApiState {
  post: Post | null
  comments: Comment[]
  postStatus: number
  commentsStatus: number
  createComment: ((body: string) => HttpResponse<DefaultBodyType>) | null
  requests: string[]
}

function mockPostApi({ post = makePost(), comments = [], pageSize = 20 }: MockPostApiOptions = {}) {
  const state: MockPostApiState = {
    post,
    comments,
    postStatus: 200,
    commentsStatus: 200,
    createComment: null,
    requests: [],
  }
  const notFound = () => HttpResponse.json({ message: 'Post not found' }, { status: 404 })
  let nextId = 100

  server.use(
    http.get(apiUrl('/posts/:id'), ({ params }) => {
      state.requests.push(`GET /posts/${params.id}`)
      if (state.postStatus !== 200) {
        return HttpResponse.json({ message: 'Server error' }, { status: state.postStatus })
      }
      if (!state.post || state.post.id !== params.id) return notFound()
      return HttpResponse.json({ ...state.post, commentCount: state.comments.length })
    }),
    http.delete(apiUrl('/posts/:id'), ({ params }) => {
      state.requests.push(`DELETE /posts/${params.id}`)
      if (!state.post || state.post.id !== params.id) return notFound()
      state.post = null
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(apiUrl('/posts/:id/comments'), ({ params, request }) => {
      if (state.commentsStatus !== 200) {
        return HttpResponse.json({ message: 'Server error' }, { status: state.commentsStatus })
      }
      if (!state.post || state.post.id !== params.id) return notFound()
      const cursor = new URL(request.url).searchParams.get('cursor')
      const start = cursor ? Number(cursor) : 0
      const end = start + pageSize
      return HttpResponse.json({
        items: state.comments.slice(start, end),
        nextCursor: end < state.comments.length ? String(end) : null,
      })
    }),
    http.post<{ id: string }, { body: string }>(apiUrl('/posts/:id/comments'), async ({ request }) => {
      const { body } = await request.json()
      if (state.createComment) return state.createComment(body)
      nextId += 1
      const comment = makeComment(`c${nextId}`, { body, createdAt: new Date().toISOString() })
      state.comments = [...state.comments, comment]
      return HttpResponse.json(comment, { status: 201 })
    }),
    http.delete(apiUrl('/posts/:id/comments/:commentId'), ({ params }) => {
      state.comments = state.comments.filter((comment) => comment.id !== params.commentId)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return state
}

const main = () => within(screen.getByRole('main'))
const replyBox = () => screen.getByRole('textbox', { name: 'Post your reply' })
const commentsSection = () => within(screen.getByRole('region', { name: 'Comments' }))
// The comments section renders once the post has loaded.
const findCommentsSection = async () =>
  within(await screen.findByRole('region', { name: 'Comments' }))

describe('PostDetail', () => {
  it('shows the post under a "Post" header, with its comments oldest first', async () => {
    mockPostApi({
      comments: [
        makeComment('c1', { body: 'First reply' }),
        makeComment('c2', { body: 'Second reply', author: { username: 'grace', displayName: null } }),
      ],
    })

    await renderApp('/u/ada/posts/p1')

    expect(await main().findByText('Hello from the detail page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Post' })).toBeInTheDocument()
    expect(main().getByText('2 comments')).toBeInTheDocument()

    const comments = await (await findCommentsSection()).findAllByRole('article')
    expect(comments).toHaveLength(2)
    expect(comments[0]).toHaveTextContent('First reply')
    expect(comments[1]).toHaveTextContent('Second reply')
    expect(within(comments[1]).getByRole('link', { name: '@grace' })).toHaveAttribute(
      'href',
      '/u/grace',
    )
    // Without a display name the author reads as before: just @username.
    expect(within(comments[0]).getByRole('link', { name: '@ada' })).toHaveAttribute('href', '/u/ada')
    const time = comments[0].querySelector('time')
    expect(time).toHaveAttribute('dateTime', CREATED_AT)
    expect(time).toHaveAttribute('title')
  })

  it('shows a loading state while the post is fetched', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockPostApi()
    server.use(
      http.get(apiUrl('/posts/:id'), async () => {
        await gate
        return HttpResponse.json(makePost())
      }),
    )

    await renderApp('/u/ada/posts/p1')

    expect(await screen.findByRole('status', { name: 'Loading post' })).toBeInTheDocument()
    release()
    expect(await main().findByText('Hello from the detail page')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading post' })).not.toBeInTheDocument()
  })

  describe('canonical URL', () => {
    it("redirects a wrong username to the author's URL (replace)", async () => {
      mockPostApi()

      await renderApp('/u/grace/posts/p1')

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/u/ada/posts/p1'))
      expect(await main().findByText('Hello from the detail page')).toBeInTheDocument()
    })

    it("doesn't redirect when only the username's case differs", async () => {
      mockPostApi()

      await renderApp('/u/ADA/posts/p1')

      expect(await main().findByText('Hello from the detail page')).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent('/u/ADA/posts/p1')
    })
  })

  it('shows "Post not found" with a link home for an unknown id, without retrying', async () => {
    const api = mockPostApi()

    await renderApp('/u/ada/posts/nope')

    expect(await main().findByText('Post not found')).toBeInTheDocument()
    expect(main().getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    expect(main().queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(api.requests).toEqual(['GET /posts/nope'])
  })

  it('shows a friendly error on a server failure and recovers on Retry', async () => {
    const api = mockPostApi()
    api.postStatus = 500

    const { user } = await renderApp('/u/ada/posts/p1')

    expect(await main().findByText(/Couldn't load this post/)).toBeInTheDocument()
    api.postStatus = 200
    await user.click(main().getByRole('button', { name: 'Retry' }))

    expect(await main().findByText('Hello from the detail page')).toBeInTheDocument()
    expect(main().queryByText(/Couldn't load this post/)).not.toBeInTheDocument()
  })

  // Back never leaves the app: it goes to the previous page only when the app pushed one before
  // this entry; redirects / replaces don't count. (In a MemoryRouter a stray navigate(-1) from the
  // first entry would leave the location unchanged, so landing on /u/ada proves it wasn't used.)
  describe('back button', () => {
    const backTo = async (user: UserEvent, pattern: RegExp) => {
      await main().findByText('Hello from the detail page')
      await user.click(main().getByRole('button', { name: 'Back' }))
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(pattern))
    }

    it("goes to the author's profile when the post was opened directly", async () => {
      mockPostApi()
      const { user } = await renderApp('/u/ada/posts/p1')

      await backTo(user, /^\/u\/ada$/)
    })

    it("goes to the author's profile after signing in from a direct link (only replaces happened)", async () => {
      mockPostApi()
      server.use(
        http.get(apiUrl('/auth/me'), () =>
          HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
        ),
        http.post(apiUrl('/auth/sign-in'), () =>
          HttpResponse.json({ id: 'u1', email: 'ada@example.com', username: 'ada' }),
        ),
      )
      const { user } = renderWithProviders(
        <>
          <AppRouter />
          <LocationDisplay />
        </>,
        { route: '/u/ada/posts/p1' },
      )

      // ProtectedRoute replaces the entry with /sign-in; signing in replaces it back.
      await screen.findByRole('heading', { name: 'Sign in' })
      await user.click(screen.getByLabelText('Email'))
      await user.paste('ada@example.com')
      await user.click(screen.getByLabelText('Password'))
      await user.paste('correct horse')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/u/ada/posts/p1'))

      await backTo(user, /^\/u\/ada$/)
    })

    it("goes to the author's profile after the canonical redirect of a direct link", async () => {
      mockPostApi()
      const { user } = await renderApp('/u/grace/posts/p1')

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/u/ada/posts/p1'))
      // The redirect replaced the entry: no in-app page behind it, so Back goes to the profile.
      await backTo(user, /^\/u\/ada$/)
    })

    it('goes back to the previous page when opened from inside the app', async () => {
      mockPostApi()
      server.use(
        http.get(apiUrl('/feed'), () => HttpResponse.json({ items: [makePost()], nextCursor: null })),
      )
      const { user } = await renderApp('/')

      const link = await main().findByRole('link', { name: /Open post by @ada/ })
      await user.click(link)
      expect(await screen.findByRole('heading', { level: 1, name: 'Post' })).toBeInTheDocument()

      await backTo(user, /^\/$/)
    })
  })

  it("deletes your own post after confirmation and goes to the author's profile", async () => {
    const api = mockPostApi()
    const { user } = await renderApp('/u/ada/posts/p1')

    const postArticle = (await main().findAllByRole('article'))[0]
    await user.click(within(postArticle).getByRole('button', { name: 'More options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete post?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/u\/ada$/))
    expect(api.requests).toContain('DELETE /posts/p1')
    expect(await screen.findByRole('heading', { name: '@ada' })).toBeInTheDocument()
  })

  describe('comments', () => {
    it('shows the empty state when there are no comments', async () => {
      mockPostApi()

      await renderApp('/u/ada/posts/p1')

      expect(
        await (await findCommentsSection()).findByText('No comments yet. Be the first to reply.'),
      ).toBeInTheDocument()
    })

    it('shows an error with Retry when comments fail to load, and recovers', async () => {
      const api = mockPostApi({ comments: [makeComment('c1', { body: 'Finally here' })] })
      api.commentsStatus = 500

      const { user } = await renderApp('/u/ada/posts/p1')

      expect(await (await findCommentsSection()).findByText(/Couldn't load comments/)).toBeInTheDocument()
      api.commentsStatus = 200
      await user.click(commentsSection().getByRole('button', { name: 'Retry' }))

      expect(await commentsSection().findByText('Finally here')).toBeInTheDocument()
    })

    it('loads more comments with "Load more comments"', async () => {
      mockPostApi({
        comments: [makeComment('c1', { body: 'Page one' }), makeComment('c2', { body: 'Page two' })],
        pageSize: 1,
      })
      const { user } = await renderApp('/u/ada/posts/p1')

      expect(await (await findCommentsSection()).findByText('Page one')).toBeInTheDocument()
      await user.click(commentsSection().getByRole('button', { name: 'Load more comments' }))

      expect(await commentsSection().findByText('Page two')).toBeInTheDocument()
      expect(
        commentsSection().queryByRole('button', { name: 'Load more comments' }),
      ).not.toBeInTheDocument()
    })

    it('appends a new comment at the end and bumps the comment count', async () => {
      mockPostApi({ comments: [makeComment('c1', { body: 'Earlier reply' })] })
      const { user } = await renderApp('/u/ada/posts/p1')

      await (await findCommentsSection()).findByText('Earlier reply')
      expect(main().getByText('1 comment')).toBeInTheDocument()

      await user.type(replyBox(), '  Latest reply  ')
      await user.click(screen.getByRole('button', { name: 'Reply' }))

      await waitFor(() => expect(replyBox()).toHaveValue(''))
      const comments = commentsSection().getAllByRole('article')
      expect(comments).toHaveLength(2)
      expect(comments[1]).toHaveTextContent('Latest reply')
      expect(main().getByText('2 comments')).toBeInTheDocument()
      // It's visible, so no extra notice.
      expect(screen.queryByText(/Load more comments to see it/)).not.toBeInTheDocument()
    })

    it("says the reply was posted when it can't be shown yet (older pages not loaded)", async () => {
      mockPostApi({
        comments: [makeComment('c1', { body: 'Page one' }), makeComment('c2', { body: 'Page two' })],
        pageSize: 1,
      })
      const { user } = await renderApp('/u/ada/posts/p1')

      await (await findCommentsSection()).findByText('Page one')
      await user.type(replyBox(), 'Hidden for now')
      await user.click(screen.getByRole('button', { name: 'Reply' }))

      await waitFor(() => expect(replyBox()).toHaveValue(''))
      const notice = await screen.findByText('Reply posted. Load more comments to see it.')
      expect(notice).toHaveAttribute('role', 'status')
      expect(commentsSection().queryByText('Hidden for now')).not.toBeInTheDocument()
      expect(main().getByText('3 comments')).toBeInTheDocument()

      // Loading the rest (one per page here) brings it in; typing again clears the notice.
      await user.click(commentsSection().getByRole('button', { name: 'Load more comments' }))
      await commentsSection().findByText('Page two')
      await user.click(
        await commentsSection().findByRole('button', { name: 'Load more comments' }),
      )
      expect(await commentsSection().findByText('Hidden for now')).toBeInTheDocument()
      await user.type(replyBox(), 'x')
      expect(screen.queryByText(/Load more comments to see it/)).not.toBeInTheDocument()
    })

    it('deletes your own comment after confirmation, moves focus to the reply box and lowers the count', async () => {
      mockPostApi({
        comments: [
          makeComment('c1', { body: 'Mine to delete' }),
          makeComment('c2', { body: 'Staying' }),
        ],
      })
      const { user } = await renderApp('/u/ada/posts/p1')

      const target = (await (await findCommentsSection()).findByText('Mine to delete')).closest('article')!
      await user.click(within(target).getByRole('button', { name: 'More options' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

      const dialog = await screen.findByRole('alertdialog', { name: 'Delete comment?' })
      // Cancel keeps it.
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(commentsSection().getByText('Mine to delete')).toBeInTheDocument()

      await user.click(within(target).getByRole('button', { name: 'More options' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
      await user.click(
        within(await screen.findByRole('alertdialog', { name: 'Delete comment?' })).getByRole(
          'button',
          { name: 'Delete' },
        ),
      )

      await waitFor(() =>
        expect(commentsSection().queryByText('Mine to delete')).not.toBeInTheDocument(),
      )
      expect(commentsSection().getByText('Staying')).toBeInTheDocument()
      expect(main().getByText('1 comment')).toBeInTheDocument()
      await waitFor(() => expect(replyBox()).toHaveFocus())
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it("has no menu on other people's comments", async () => {
      mockPostApi({
        comments: [
          makeComment('c1', { body: 'From grace', author: { username: 'grace', displayName: null } }),
          makeComment('c2', { body: 'From ada' }),
        ],
      })
      await renderApp('/u/ada/posts/p1')

      const graces = (await (await findCommentsSection()).findByText('From grace')).closest('article')!
      const adas = commentsSection().getByText('From ada').closest('article')!
      expect(within(graces).queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
      expect(within(adas).getByRole('button', { name: 'More options' })).toBeInTheDocument()
    })
  })
})
