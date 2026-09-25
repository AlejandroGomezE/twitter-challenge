import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Share,
  type LucideIcon,
} from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ComingSoon } from '@/components/layout/ComingSoon';
import { UserAvatar } from '@/components/UserAvatar';
import { UserName } from '@/components/UserName';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { useDeletePost, useToggleLike } from '@/hooks/use-posts';
import { getApiErrorMessage } from '@/lib/api/error-message';
import type { Post } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/use-auth';
import { formatCount, formatFullDate, formatRelativeShort } from '@/lib/format';
import { cn } from '@/lib/utils';

const actionClass =
  'inline-flex items-center gap-1.5 rounded-full p-2 font-mono text-sm tabular-nums text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

const COMING_SOON_ACTIONS: { label: string; icon: LucideIcon }[] = [
  { label: 'Repost', icon: Repeat2 },
  { label: 'Bookmark', icon: Bookmark },
  { label: 'Share', icon: Share },
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// A post in Pulse's card layout: avatar, display name + @username (→ profile), relative time, the body as plain
// text, and an action row (comments → detail, like toggle, repost / bookmark / share "Coming
// soon"). Your own posts get a "…" menu with Delete behind a confirmation; others' posts get no
// menu at all.
//
// In the default ("card") variant a click anywhere on the card opens the post's detail page,
// except clicks on inner links / buttons / menu items (or from portaled menus / dialogs) and
// clicks that end a text selection. That mouse affordance is an extra: for keyboard and screen
// reader users the timestamp is the post's real `<Link>` (Twitter's pattern), so "open post" is a
// single tab stop and no interactive element is nested inside another. The body stays plain,
// selectable text.
//
// `variant="detail"` (the post detail page): larger body, full timestamp, not clickable as a
// whole. `onDeleted` runs after a successful delete (the detail page navigates away; lists move
// focus with usePostRemovalFocus).
// Needs a `TooltipProvider` above it (AppShell provides one) for the "Coming soon" actions.
export interface PostCardProps {
  post: Post;
  variant?: 'card' | 'detail';
  onDeleted?: () => void;
  className?: string;
}

export function PostCard({ post, variant = 'card', onDeleted, className }: PostCardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toggleLike = useToggleLike();

  const isDetail = variant === 'detail';
  const username = post.author.username;
  const profilePath = `/u/${encodeURIComponent(username)}`;
  const detailPath = `${profilePath}/posts/${encodeURIComponent(post.id)}`;
  const isOwn = !!user?.username && user.username.toLowerCase() === username.toLowerCase();
  const fullDate = formatFullDate(post.createdAt);

  function handleCardClick(event: MouseEvent<HTMLElement>) {
    if (isDetail || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const { target } = event;
    // Clicks from portaled content (menu, dialog) bubble through React but aren't in the card.
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (target.closest('a,button,[role=menuitem]')) return;
    if (window.getSelection()?.toString()) return;
    navigate(detailPath);
  }

  function handleLike() {
    toggleLike.mutate({ postId: post.id, liked: !post.likedByMe });
  }

  return (
    // The click handler is a mouse shortcut; keyboard users open the post via the timestamp link.
    <article
      data-post-id={post.id}
      onClick={handleCardClick}
      className={cn(
        'flex gap-3.5 border-b border-border px-5 py-4 transition-colors sm:px-6',
        !isDetail && 'cursor-pointer hover:bg-muted/40',
        className,
      )}
    >
      <Link to={profilePath} tabIndex={-1} aria-hidden="true" className="shrink-0 self-start">
        <UserAvatar username={username} className="size-11" />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-sm">
            <Link
              to={profilePath}
              className="min-w-0 max-w-full truncate rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <UserName username={username} displayName={post.author.displayName} />
            </Link>
            {!isDetail && (
              <>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <Link
                  to={detailPath}
                  data-post-link
                  aria-label={`Open post by @${username}, ${fullDate}`}
                  className="rounded-sm font-mono text-muted-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <time dateTime={post.createdAt} title={fullDate}>
                    {formatRelativeShort(post.createdAt)}
                  </time>
                </Link>
              </>
            )}
          </div>

          {isOwn && <PostMenu post={post} onDeleted={onDeleted} />}
        </div>

        <p
          className={cn(
            'mt-1 break-words whitespace-pre-wrap text-foreground',
            isDetail ? 'text-xl leading-relaxed' : 'text-[15px] leading-relaxed',
          )}
        >
          {post.body}
        </p>

        {isDetail && (
          <p className="mt-3 font-mono text-sm text-muted-foreground">
            <time dateTime={post.createdAt}>{fullDate}</time>
          </p>
        )}

        <div className="mt-2 -ml-2 flex max-w-md items-center justify-between">
          {isDetail ? (
            <span className={actionClass}>
              <MessageCircle className="size-[18px]" aria-hidden="true" />
              <span aria-hidden="true">{formatCount(post.commentCount)}</span>
              <span className="sr-only">{plural(post.commentCount, 'comment')}</span>
            </span>
          ) : (
            <Link
              to={detailPath}
              aria-label={`Comments, ${plural(post.commentCount, 'comment')}`}
              className={cn(actionClass, 'hover:bg-primary/10 hover:text-primary')}
            >
              <MessageCircle className="size-[18px]" aria-hidden="true" />
              <span aria-hidden="true">{formatCount(post.commentCount)}</span>
            </Link>
          )}

          <button
            type="button"
            onClick={handleLike}
            aria-pressed={post.likedByMe}
            aria-label={`Like, ${plural(post.likeCount, 'like')}`}
            className={cn(
              actionClass,
              'hover:bg-primary/10 hover:text-primary',
              post.likedByMe && 'text-primary',
            )}
          >
            <Heart
              className={cn('size-[18px]', post.likedByMe && 'fill-current')}
              aria-hidden="true"
            />
            <span aria-hidden="true">{formatCount(post.likeCount)}</span>
          </button>

          {COMING_SOON_ACTIONS.map(({ label, icon: Icon }) => (
            <ComingSoon key={label} side="top">
              <button type="button" aria-label={label} className={actionClass}>
                <Icon className="size-[18px]" aria-hidden="true" />
              </button>
            </ComingSoon>
          ))}
        </div>
      </div>
    </article>
  );
}

// The own-post "…" menu: Delete → confirmation dialog → useDeletePost. The dialog stays open while
// the request runs and shows the server's error if it fails.
function PostMenu({ post, onDeleted }: Pick<PostCardProps, 'post' | 'onDeleted'>) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deletePost = useDeletePost();

  function handleOpenChange(open: boolean) {
    if (deletePost.isPending) return;
    if (!open) deletePost.reset();
    setConfirmOpen(open);
  }

  function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    // Keep the dialog open until the request settles.
    event.preventDefault();
    deletePost.mutate(post, {
      onSuccess: () => {
        setConfirmOpen(false);
        onDeleted?.();
      },
    });
  }

  return (
    <>
      {/* Non-modal so closing the menu doesn't fight the dialog over focus / pointer-events. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More options"
            className="-mt-1 -mr-2 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
            <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {deletePost.isError && (
            <p role="alert" className="text-sm text-destructive">
              {getApiErrorMessage(deletePost.error)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePost.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirm}
              disabled={deletePost.isPending}
            >
              {deletePost.isPending && <Spinner aria-hidden="true" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
