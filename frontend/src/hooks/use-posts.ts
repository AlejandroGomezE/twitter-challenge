import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useRetryUnlessNotFound } from '@/hooks/use-retry-unless-not-found';
import {
  bumpProfilePostCount,
  cancelLoadedFetches,
  findPostInCaches,
  postQueryFilters,
  prependPostToList,
  profileQueryFilters,
  removePostFromCaches,
  setLikeInCaches,
  updatePostInCaches,
  writeAfterServerChange,
} from '@/lib/api/post-cache';
import {
  createPost,
  deletePost,
  fetchFeed,
  fetchForYouFeed,
  fetchPost,
  fetchUserPosts,
  postKeys,
  setPostLiked,
} from '@/lib/api/posts';
import type { LikeState, Page, Post, PostAuthor } from '@/lib/api/types';

// Next page's cursor, or `undefined` to tell TanStack there are no more pages.
export const getNextPageParam = <T>(lastPage: Page<T>) => lastPage.nextCursor ?? undefined;

// The Following feed (the signed-in user + everyone they follow), newest first, paged by cursor.
export function useFeed() {
  return useInfiniteQuery({
    queryKey: postKeys.feed(),
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam,
  });
}

// The For you feed (every user's posts), newest first, paged by cursor.
export function useForYouFeed() {
  return useInfiniteQuery({
    queryKey: postKeys.forYou(),
    queryFn: ({ pageParam }) => fetchForYouFeed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam,
  });
}

// A user's posts, newest first, paged by cursor. A 404 (unknown user) is not retried.
export function useUserPosts(username: string) {
  const retry = useRetryUnlessNotFound();

  return useInfiniteQuery({
    queryKey: postKeys.userPosts(username),
    queryFn: ({ pageParam }) => fetchUserPosts(username, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam,
    retry,
  });
}

// One post by id. A 404 (unknown / deleted post) is not retried.
export function usePost(id: string) {
  const retry = useRetryUnlessNotFound();

  return useQuery({
    queryKey: postKeys.detail(id),
    queryFn: () => fetchPost(id),
    retry,
  });
}

// `mutate(body)` → the created Post. On success the post is written straight into the loaded
// caches (top of both feeds' and the author's first page, +1 on the author's profile postCount)
// instead of invalidating them, so it shows up at once without a refetch flash. In-flight fetches
// of those entries are cancelled first (see post-cache.ts) so a stale one can't drop the post.
export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: string) => createPost(body),
    onSuccess: (post) => {
      const username = post.author.username;
      return writeAfterServerChange(
        queryClient,
        [...postQueryFilters(post.id), ...profileQueryFilters(username)],
        () => {
          queryClient.setQueryData(postKeys.detail(post.id), post);
          prependPostToList(queryClient, postKeys.feed(), post);
          prependPostToList(queryClient, postKeys.forYou(), post);
          prependPostToList(queryClient, postKeys.userPosts(username), post);
          bumpProfilePostCount(queryClient, username, 1);
        },
      );
    },
  });
}

// What deleting a post needs from it.
export interface DeletablePost {
  id: Post['id'];
  author: Pick<PostAuthor, 'username'>;
}

// `mutate(post)` (needs `id` and `author.username`). On success the post is dropped from every
// cached list, its detail/comments entries are removed and the author's postCount goes down by 1
// — after cancelling in-flight fetches, so a stale one can't bring the post back.
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (post: DeletablePost) => deletePost(post.id),
    onSuccess: (_data, post) => {
      const username = post.author.username;
      return writeAfterServerChange(
        queryClient,
        [
          ...postQueryFilters(post.id),
          { queryKey: postKeys.comments(post.id), exact: true },
          ...profileQueryFilters(username),
        ],
        () => {
          removePostFromCaches(queryClient, post.id);
          bumpProfilePostCount(queryClient, username, -1);
        },
      );
    },
  });
}

// Like "bursts", per QueryClient and post id: the like requests for a post that overlap in time
// (e.g. a fast double click). `confirmed` is the last state the server is known to hold — the
// cached state when the burst started, replaced by every successful response that is newer (by
// click order) than the one it holds. When the burst's last request settles, the caches are set
// to `confirmed`, so the result matches the server whichever requests failed and in whatever
// order the responses arrived.
interface LikeBurst {
  // Click count of the burst (the latest request's sequence number).
  seq: number;
  // Requests not settled yet.
  pending: number;
  // Sequence number of the response `confirmed` came from (0: the cached starting state).
  confirmedSeq: number;
  // null when the post wasn't cached when the burst began and no request has succeeded yet.
  confirmed: LikeState | null;
}

const likeBursts = new WeakMap<QueryClient, Map<string, LikeBurst>>();

function getLikeBursts(queryClient: QueryClient) {
  let bursts = likeBursts.get(queryClient);
  if (!bursts) {
    bursts = new Map();
    likeBursts.set(queryClient, bursts);
  }
  return bursts;
}

// Whether `burst` is still the live burst of `postId` (false once `resetLikeBursts` ran).
const isLiveBurst = (queryClient: QueryClient, postId: string, burst: LikeBurst) =>
  likeBursts.get(queryClient)?.get(postId) === burst;

// Forgets every like burst of `queryClient`. Called on sign-out (AuthProvider) next to the cache
// clearing, so a like still in flight from the previous session can't write into the next user's
// cache: its remaining steps see the burst is no longer live and do nothing.
export function resetLikeBursts(queryClient: QueryClient) {
  likeBursts.delete(queryClient);
}

// Whether post `postId` has a like burst that hasn't finished yet (requests in flight, or the
// final reconcile still pending). Read-only; lets realtime count updates stay out of its way.
export function hasLikeInFlight(queryClient: QueryClient, postId: string) {
  return likeBursts.get(queryClient)?.has(postId) ?? false;
}

const applyLike = (liked: boolean) => (post: Post): Post =>
  post.likedByMe === liked
    ? post
    : { ...post, likedByMe: liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) };

// `mutate({ postId, liked })` where `liked` is the intended final state (`!post.likedByMe`).
// The request is PUT (like) or DELETE (unlike) — idempotent, so rapid clicks just send the latest
// intent. Optimistic: in-flight fetches of the post's lists/detail are cancelled, then
// `likedByMe` / `likeCount` flip everywhere the post is cached. When the last request of the burst
// settles, the caches get the server-confirmed state (see `likeBursts`) after cancelling any fetch
// still in flight, so neither a failed request nor a stale refetch can leave a wrong state.
export interface ToggleLikeVariables {
  postId: string;
  // The intended final state.
  liked: boolean;
}

export function useToggleLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, liked }: ToggleLikeVariables) => setPostLiked(postId, liked),
    onMutate: async ({ postId, liked }: ToggleLikeVariables) => {
      const bursts = getLikeBursts(queryClient);
      let burst = bursts.get(postId);
      if (!burst) {
        const post = findPostInCaches(queryClient, postId);
        burst = {
          seq: 0,
          pending: 0,
          confirmedSeq: 0,
          confirmed: post ? { liked: post.likedByMe, likeCount: post.likeCount } : null,
        };
        bursts.set(postId, burst);
      }
      burst.seq += 1;
      burst.pending += 1;
      const seq = burst.seq;

      await cancelLoadedFetches(queryClient, postQueryFilters(postId));
      if (isLiveBurst(queryClient, postId, burst)) {
        updatePostInCaches(queryClient, postId, applyLike(liked));
      }
      return { seq, burst };
    },
    onSettled: (result, error, { postId }, context) => {
      const burst = context?.burst;
      if (!burst || !isLiveBurst(queryClient, postId, burst)) return undefined;

      if (!error && result && context.seq > burst.confirmedSeq) {
        burst.confirmed = { liked: result.liked, likeCount: result.likeCount };
        burst.confirmedSeq = context.seq;
      }
      burst.pending -= 1;
      if (burst.pending > 0) return undefined;

      return writeAfterServerChange(queryClient, postQueryFilters(postId), () => {
        // A new click during the cancel joined this burst; its own settle will finish it.
        if (burst.pending > 0 || !isLiveBurst(queryClient, postId, burst)) return;
        likeBursts.get(queryClient)?.delete(postId);
        if (burst.confirmed) {
          setLikeInCaches(queryClient, postId, burst.confirmed);
        } else {
          // The post wasn't cached when the burst began and no request succeeded: refetch it.
          queryClient.invalidateQueries({ queryKey: postKeys.lists() });
          queryClient.invalidateQueries({ queryKey: postKeys.detail(postId), exact: true });
        }
      });
    },
  });
}
