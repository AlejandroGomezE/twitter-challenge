import { useQueryClient } from '@tanstack/react-query';
import { hasLikeInFlight } from '@/hooks/use-posts';
import {
  bumpProfilePostCount,
  findPostInCaches,
  profileQueryFilters,
  removePostFromLists,
  updatePostInCaches,
  writeAfterServerChange,
} from '@/lib/api/post-cache';
import { postKeys } from '@/lib/api/posts';
import { useRealtimeEvent } from '@/lib/realtime/use-realtime';

// `post.counts` `{ id, likeCount, commentCount }`: sets both counts on every cached copy of the
// post; `likedByMe` is the viewer's own state and is never touched. Skipped while the viewer has a
// like toggle in flight for that post (its reconcile owns `likeCount` until it settles). A post
// that isn't cached anywhere is ignored — nothing is refetched.
function applyCounts(queryClient, data) {
  const { id, likeCount, commentCount } = data ?? {};
  if (typeof id !== 'string' || typeof likeCount !== 'number' || typeof commentCount !== 'number') {
    return;
  }
  if (hasLikeInFlight(queryClient, id)) return;
  updatePostInCaches(queryClient, id, (post) =>
    post.likeCount === likeCount && post.commentCount === commentCount
      ? post
      : { ...post, likeCount, commentCount },
  );
}

// `post.deleted` `{ id }`: the same cache changes `useDeletePost` makes for the author — the post
// leaves every list, its comments entry is dropped and the author's cached profile postCount goes
// down by 1 (only when a cached copy tells us who the author is) — after cancelling in-flight
// fetches that could bring it back. If a PostDetail is showing it, its detail entry is refetched
// instead of removed: the server answers 404 and the page shows its existing "Post not found"
// state. Its comments entry is dropped only after that, once the comment list is gone from the
// screen (removing it earlier would make the still-mounted list refetch).
async function applyDeleted(queryClient, data) {
  const id = data?.id;
  if (typeof id !== 'string') return;

  const username = findPostInCaches(queryClient, id)?.author?.username;
  const detailKey = postKeys.detail(id);
  const commentsKey = postKeys.comments(id);
  const detailShown =
    queryClient.getQueryCache().find({ queryKey: detailKey, exact: true })?.isActive() ?? false;

  const filters = [
    { queryKey: postKeys.lists() },
    { queryKey: commentsKey, exact: true },
    ...(detailShown ? [] : [{ queryKey: detailKey, exact: true }]),
    ...(username ? profileQueryFilters(username) : []),
  ];

  await writeAfterServerChange(queryClient, filters, () => {
    removePostFromLists(queryClient, id);
    if (username) bumpProfilePostCount(queryClient, username, -1);
    if (!detailShown) {
      queryClient.removeQueries({ queryKey: detailKey, exact: true });
      queryClient.removeQueries({ queryKey: commentsKey, exact: true });
    }
  });

  if (detailShown) {
    await queryClient.refetchQueries({ queryKey: detailKey, exact: true });
    queryClient.removeQueries({ queryKey: commentsKey, exact: true });
  }
}

// Keeps the post caches in step with the realtime stream (mount once, inside the
// RealtimeProvider): live like/comment counts and posts deleted by their authors. Neither event
// is sent to the user who caused it — their own client already applied the change.
export function usePostsRealtimeSync() {
  const queryClient = useQueryClient();

  useRealtimeEvent('post.counts', (data) => applyCounts(queryClient, data));
  useRealtimeEvent('post.deleted', (data) => {
    applyDeleted(queryClient, data);
  });
}
