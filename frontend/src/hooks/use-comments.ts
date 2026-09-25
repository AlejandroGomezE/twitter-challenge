import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryFilters,
} from '@tanstack/react-query';
import { getNextPageParam } from '@/hooks/use-posts';
import { useRetryUnlessNotFound } from '@/hooks/use-retry-unless-not-found';
import { bumpCommentCount, postQueryFilters, writeAfterServerChange } from '@/lib/api/post-cache';
import { createComment, deleteComment, fetchComments, postKeys } from '@/lib/api/posts';
import type { Comment, Page } from '@/lib/api/types';

// A post's cached comments (an infinite query of comment pages).
type CommentListData = InfiniteData<Page<Comment>>;

// Every cache entry a comment write touches: the post's lists/detail (commentCount) + its comments.
const commentWriteFilters = (postId: string): QueryFilters[] => [
  ...postQueryFilters(postId),
  { queryKey: postKeys.comments(postId), exact: true },
];

// Comments are oldest first, so a new one belongs at the very end: it's appended to the last
// loaded page only when every page is loaded. Otherwise it would sit above comments that a later
// "load more" brings in (and then show up twice) — it arrives with the last page instead.
function appendComment(data: CommentListData | undefined, comment: Comment) {
  if (!data?.pages?.length) return data;
  const last = data.pages[data.pages.length - 1];
  if (last.nextCursor) return data;
  if (data.pages.some((page) => page.items.some((item) => item.id === comment.id))) return data;
  return {
    ...data,
    pages: [...data.pages.slice(0, -1), { ...last, items: [...last.items, comment] }],
  };
}

function removeComment(data: CommentListData | undefined, commentId: string) {
  if (!data?.pages) return data;
  return {
    ...data,
    pages: data.pages.map((page) =>
      page.items.some((item) => item.id === commentId)
        ? { ...page, items: page.items.filter((item) => item.id !== commentId) }
        : page,
    ),
  };
}

// A post's comments, oldest first, paged by cursor. A 404 (unknown post) is not retried.
export function useComments(postId: string) {
  const retry = useRetryUnlessNotFound();

  return useInfiniteQuery({
    queryKey: postKeys.comments(postId),
    queryFn: ({ pageParam }) => fetchComments(postId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam,
    retry,
  });
}

// `mutate(body)` → the created Comment: appended to the comments cache (see `appendComment`) and
// +1 on the post's commentCount everywhere it's cached — after cancelling in-flight fetches of
// those entries (see post-cache.ts).
export function useCreateComment(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: string) => createComment(postId, body),
    onSuccess: (comment) =>
      writeAfterServerChange(queryClient, commentWriteFilters(postId), () => {
        queryClient.setQueryData<CommentListData>(postKeys.comments(postId), (data) =>
          appendComment(data, comment),
        );
        bumpCommentCount(queryClient, postId, 1);
      }),
  });
}

// `mutate(commentId)`: removed from the comments cache and -1 on the post's commentCount.
export function useDeleteComment(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => deleteComment(postId, commentId),
    onSuccess: (_data, commentId) =>
      writeAfterServerChange(queryClient, commentWriteFilters(postId), () => {
        queryClient.setQueryData<CommentListData>(postKeys.comments(postId), (data) =>
          removeComment(data, commentId),
        );
        bumpCommentCount(queryClient, postId, -1);
      }),
  });
}
