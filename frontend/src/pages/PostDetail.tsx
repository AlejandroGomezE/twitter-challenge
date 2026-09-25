import { CommentComposer } from '@/components/feed/CommentComposer';
import { CommentItem } from '@/components/feed/CommentItem';
import { InfiniteListFooter } from '@/components/feed/InfiniteListFooter';
import { PostCard } from '@/components/feed/PostCard';
import { PostListSkeleton } from '@/components/feed/PostListSkeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useComments } from '@/hooks/use-comments';
import { usePost } from '@/hooks/use-posts';
import { ApiError } from '@/lib/api/client';
import type { Comment } from '@/lib/api/types';
import { useCanGoBackInApp } from '@/lib/navigation-history';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';

const profilePath = (username: string) => `/u/${encodeURIComponent(username)}`;

const postPath = (username: string, id: string) =>
  `${profilePath(username)}/posts/${encodeURIComponent(id)}`;

// `/u/:username/posts/:id` — a post with its comments. Looked up by id; if `:username` doesn't
// match the author (case-insensitive) it redirects to the canonical URL. Unknown id → "Post not
// found"; other failures → a friendly error with Retry.
export function PostDetail() {
  // Both are always set: this page is only mounted on `/u/:username/posts/:id`.
  const { username = '', id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBackInApp = useCanGoBackInApp();
  const { data: post, error, isPending, isError, isFetching, refetch } = usePost(id);

  // Back: to the previous page only when the app itself pushed an entry before this one (see
  // lib/navigation-history.js — redirects and replaces don't count), else to the author's profile
  // (the post's author once it's loaded, the URL's username until then). It never leaves the app.
  const backTarget = profilePath(post?.author.username ?? username);
  function goBack() {
    if (canGoBackInApp(location.key)) navigate(-1);
    else navigate(backTarget);
  }

  const header = (
    <PageHeader
      title="Post"
      leading={
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={goBack}
          aria-label="Back"
          className="rounded-full"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Button>
      }
    />
  );

  if (isPending) {
    return (
      <>
        {header}
        <div className="border-b border-border px-5 py-4 sm:px-6" aria-busy="true">
          <Spinner className="sr-only" aria-label="Loading post" />
          <div className="flex gap-3.5">
            <Skeleton className="size-11 shrink-0 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-6 w-full" />
              <Skeleton className="mt-2 h-6 w-2/3" />
              <Skeleton className="mt-4 h-4 w-40" />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (isError && error instanceof ApiError && error.status === 404) {
    return (
      <>
        {header}
        <Empty className="px-5 py-16 sm:px-6">
          <EmptyHeader>
            <EmptyTitle>Post not found</EmptyTitle>
            <EmptyDescription>
              This post doesn&apos;t exist or has been deleted.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" className="rounded-full font-semibold">
              <Link to="/">Back to home</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  if (isError) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4 px-5 py-6 sm:px-6">
          <Alert variant="destructive">
            <AlertDescription>
              Couldn&apos;t load this post. Check your connection and try again.
            </AlertDescription>
          </Alert>
          <Button
            onClick={() => refetch()}
            disabled={isFetching}
            className="self-start rounded-full px-5 font-semibold"
          >
            {isFetching && <Spinner aria-hidden="true" />}
            Retry
          </Button>
        </div>
      </>
    );
  }

  const author = post.author.username;
  if (username.toLowerCase() !== author.toLowerCase()) {
    return <Navigate to={postPath(author, post.id)} replace />;
  }

  return (
    <>
      {header}
      <PostCard
        post={post}
        variant="detail"
        onDeleted={() => navigate(profilePath(author), { replace: true })}
      />
      <Comments postId={post.id} />
    </>
  );
}

// The reply composer and the comments (oldest first, paged). After you delete a comment its item
// (and the dialog's return-focus target) is gone, so focus moves to the reply box instead — once
// the comment has actually left the rendered list, i.e. after the dialog's focus trap is torn down.
function Comments({ postId }: { postId: string }) {
  const comments = useComments(postId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The deleted comment still on screen, waiting to leave the list before focus moves.
  const pendingFocusRef = useRef<string | null>(null);
  // The last committed items (updated in an effect, so it matches what's on screen).
  const renderedItemsRef = useRef<Comment[] | undefined>(undefined);
  const items = comments.data?.pages.flatMap((page) => page.items);

  useEffect(() => {
    renderedItemsRef.current = items;
    const pending = pendingFocusRef.current;
    if (!pending || !items || items.some((item) => item.id === pending)) return;
    pendingFocusRef.current = null;
    textareaRef.current?.focus();
  }, [items]);

  function handleDeleted(commentId: string) {
    if (renderedItemsRef.current?.some((item) => item.id === commentId)) {
      pendingFocusRef.current = commentId;
    } else {
      textareaRef.current?.focus();
    }
  }

  return (
    <section aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="sr-only">
        Comments
      </h2>
      <CommentComposer postId={postId} textareaRef={textareaRef} />
      <CommentList
        comments={comments}
        items={items}
        postId={postId}
        onDeleted={handleDeleted}
      />
    </section>
  );
}

interface CommentListProps {
  comments: ReturnType<typeof useComments>;
  items?: Comment[];
  postId: string;
  onDeleted: (commentId: string) => void;
}

function CommentList({ comments, items, postId, onDeleted }: CommentListProps) {
  if (comments.isPending) return <PostListSkeleton label="Loading comments" count={2} />;

  if (comments.isError && !comments.data) {
    return (
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-6">
        <Alert variant="destructive">
          <AlertDescription>
            Couldn&apos;t load comments. Check your connection and try again.
          </AlertDescription>
        </Alert>
        <Button
          onClick={() => comments.refetch()}
          disabled={comments.isFetching}
          className="self-start rounded-full px-5 font-semibold"
        >
          {comments.isFetching && <Spinner aria-hidden="true" />}
          Retry
        </Button>
      </div>
    );
  }

  // `items` is always set by now (the pending and error-without-data cases returned above).
  if (!items || items.length === 0) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-12 text-center">
        <MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No comments yet. Be the first to reply.</p>
      </div>
    );
  }

  return (
    <>
      {items.map((comment) => (
        <CommentItem key={comment.id} comment={comment} postId={postId} onDeleted={onDeleted} />
      ))}
      <InfiniteListFooter
        query={comments}
        loadMoreLabel="Load more comments"
        errorMessage="Couldn't load more comments. Check your connection and try again."
      />
    </>
  );
}
