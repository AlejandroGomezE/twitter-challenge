import { MoreHorizontal } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
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
import { useDeleteComment } from '@/hooks/use-comments';
import { getApiErrorMessage } from '@/lib/api/error-message';
import type { Comment } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/use-auth';
import { formatFullDate, formatRelativeShort } from '@/lib/format';

// One comment under a post: avatar, display name + @username (→ profile), relative time (full date on hover) and
// the body as plain text with line breaks kept. Your own comments get a "More options" menu →
// Delete → confirmation dialog → useDeleteComment; others' comments have no menu.
// `onDeleted(commentId)` runs once the delete succeeded (the list moves focus, since this item and
// its dialog are gone by then).
export interface CommentItemProps {
  comment: Comment;
  postId: string;
  onDeleted?: (commentId: string) => void;
}

export function CommentItem({ comment, postId, onDeleted }: CommentItemProps) {
  const { user } = useAuth();
  const username = comment.author.username;
  const profilePath = `/u/${encodeURIComponent(username)}`;
  const isOwn = !!user?.username && user.username.toLowerCase() === username.toLowerCase();

  return (
    <article className="flex gap-3.5 border-b border-border px-5 py-4 sm:px-6">
      <Link to={profilePath} tabIndex={-1} aria-hidden="true" className="shrink-0 self-start">
        <UserAvatar username={username} className="size-10" />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-sm">
            <Link
              to={profilePath}
              className="min-w-0 max-w-full truncate rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <UserName username={username} displayName={comment.author.displayName} />
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <time
              dateTime={comment.createdAt}
              title={formatFullDate(comment.createdAt)}
              className="font-mono text-muted-foreground"
            >
              {formatRelativeShort(comment.createdAt)}
            </time>
          </div>

          {isOwn && <CommentMenu comment={comment} postId={postId} onDeleted={onDeleted} />}
        </div>

        {/* Plain text: a text node (never HTML), keeping the author's line breaks. */}
        <p className="mt-1 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
          {comment.body}
        </p>
      </div>
    </article>
  );
}

// The own-comment "More options" menu: Delete → confirmation → useDeleteComment. The dialog stays
// open while the request runs and shows the server's error if it fails. On success the comment
// leaves the cache, which unmounts this item (and its dialog) — so the outcome is awaited through
// `mutateAsync` (its promise settles even after unmount) rather than per-call `mutate` callbacks.
function CommentMenu({ comment, postId, onDeleted }: CommentItemProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteComment = useDeleteComment(postId);

  function handleOpenChange(open: boolean) {
    if (deleteComment.isPending) return;
    if (!open) deleteComment.reset();
    setConfirmOpen(open);
  }

  async function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    // Keep the dialog open until the request settles.
    event.preventDefault();
    try {
      await deleteComment.mutateAsync(comment.id);
    } catch {
      // Shown in the dialog through `deleteComment.error`.
      return;
    }
    setConfirmOpen(false);
    onDeleted?.(comment.id);
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
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteComment.isError && (
            <p role="alert" className="text-sm text-destructive">
              {getApiErrorMessage(deleteComment.error)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteComment.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirm}
              disabled={deleteComment.isPending}
            >
              {deleteComment.isPending && <Spinner aria-hidden="true" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
