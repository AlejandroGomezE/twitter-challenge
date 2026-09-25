import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  useId,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { CharacterCounter } from '@/components/feed/CharacterCounter';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useCreateComment } from '@/hooks/use-comments';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { postKeys } from '@/lib/api/posts';
import type { Comment, Page } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/use-auth';
import { isSubmitShortcut, measureBody } from '@/lib/text';

const RATE_LIMIT_MESSAGE = 'Too many comments. Try again in a minute.';
const NOT_SHOWN_NOTICE = 'Reply posted. Load more comments to see it.';

// Whether the comments list is loaded but doesn't show `comment`: it's only appended once every
// page is loaded (see useCreateComment); otherwise it arrives with the last page. A list that
// isn't loaded at all will fetch it anyway.
const isHiddenInLoadedList = (data: InfiniteData<Page<Comment>> | undefined, comment: Comment) =>
  !!data?.pages?.length &&
  !data.pages.some((page) => page.items.some((item) => item.id === comment.id));

// The reply box on a post's detail page: the signed-in user's avatar, an auto-growing textarea
// ("Post your reply"), the shared `N/280` counter and "Reply". Same rules as the post Composer:
// the trimmed body is counted in code points, Reply is disabled while blank / over 280 / sending,
// Cmd/Ctrl+Enter sends (not while an IME is composing), the textarea is read-only while sending,
// cleared on success and kept on failure with the server's error below it (400 messages joined,
// 429 → "Too many comments…"). When the new reply isn't shown yet (older pages still to load), a
// polite status says so; after a normal append there's nothing extra. `textareaRef` lets the page move focus here (e.g. after a delete).
export interface CommentComposerProps {
  postId: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function CommentComposer({ postId, textareaRef }: CommentComposerProps) {
  const { user } = useAuth();
  const username = user?.username;
  const counterId = useId();
  const errorId = useId();
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState('');
  const queryClient = useQueryClient();
  const createComment = useCreateComment(postId);

  const { trimmed, length, remaining, isOver, isValid } = measureBody(body);
  const canSubmit = isValid && !createComment.isPending;

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setBody(event.target.value);
    setNotice('');
    // The error was about the previous text; editing it dismisses the message.
    if (createComment.isError) createComment.reset();
  }

  function submit() {
    if (!canSubmit) return;
    setNotice('');
    createComment.mutate(trimmed, {
      onSuccess: (comment) => {
        setBody('');
        // Runs after the hook's cache write, so the list's cache is final here.
        const data = queryClient.getQueryData<InfiniteData<Page<Comment>>>(postKeys.comments(postId));
        if (isHiddenInLoadedList(data, comment)) setNotice(NOT_SHOWN_NOTICE);
      },
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isSubmitShortcut(event)) return;
    event.preventDefault();
    submit();
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3.5 border-b border-border px-5 py-4 sm:px-6">
      {username && <UserAvatar username={username} className="size-10" />}

      <div className="min-w-0 flex-1">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          readOnly={createComment.isPending}
          aria-label="Post your reply"
          aria-describedby={createComment.isError ? `${counterId} ${errorId}` : counterId}
          aria-invalid={isOver || undefined}
          placeholder="Post your reply"
          className="min-h-0 resize-none rounded-none border-0 bg-transparent px-0 pt-1.5 text-base leading-relaxed shadow-none focus-visible:ring-0 aria-invalid:ring-0 md:text-base dark:bg-transparent"
        />

        {createComment.isError && (
          <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
            {getApiErrorMessage(createComment.error, { rateLimitMessage: RATE_LIMIT_MESSAGE })}
          </p>
        )}

        {/* Always mounted so screen readers pick up the text when it appears. */}
        <p role="status" className="mt-1 text-sm text-muted-foreground empty:hidden">
          {notice}
        </p>

        <div className="mt-2 flex items-center justify-end gap-3">
          <CharacterCounter id={counterId} length={length} remaining={remaining} />
          <Button type="submit" disabled={!canSubmit} className="rounded-full px-5 font-semibold">
            {createComment.isPending && <Spinner aria-hidden="true" />}
            Reply
          </Button>
        </div>
      </div>
    </form>
  );
}
