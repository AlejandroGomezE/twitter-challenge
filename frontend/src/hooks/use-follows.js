import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getNextPageParam } from '@/hooks/use-posts';
import { useRetryUnlessNotFound } from '@/hooks/use-retry-unless-not-found';
import {
  bumpProfileFollowingCount,
  findFollowState,
  followQueryFilters,
  setFollowInProfile,
  setFollowingInLists,
} from '@/lib/api/follow-cache';
import { cancelLoadedFetches, writeAfterServerChange } from '@/lib/api/post-cache';
import { postKeys } from '@/lib/api/posts';
import {
  fetchFollowers,
  fetchFollowing,
  fetchSuggestions,
  followKeys,
  profileQueryKey,
  setFollowing,
} from '@/lib/api/users';
import { useAuth } from '@/lib/auth/use-auth';

// Users following `username`, most recent follow first, paged by cursor. A 404 (unknown user) is
// not retried. Pass `{ enabled: false }` to hold the fetch (e.g. while a dialog tab is hidden).
// `alwaysFresh: true` makes this observer treat the cache as always stale (`staleTime: 0`), so the
// list refetches every time it becomes enabled (dialog opened on it, tab switched to it) while the
// cached rows stay on screen. It does not refetch on a follow toggle: `useToggleFollow` only marks
// the lists stale, so an open list keeps its rows — and for the same reason it doesn't refetch on
// window focus / reconnect. Rows of a page that lands while a follow of that
// user is in flight keep the optimistic follow state (`withPendingFollow`).
export function useFollowers(username, options) {
  return useFollowList(followKeys.followers(username), fetchFollowers, username, options);
}

// Users `username` follows, most recent follow first, paged by cursor. Same options as above.
export function useFollowing(username, options) {
  return useFollowList(followKeys.following(username), fetchFollowing, username, options);
}

function useFollowList(queryKey, fetchPage, username, { enabled = true, alwaysFresh = false } = {}) {
  const queryClient = useQueryClient();
  const retry = useRetryUnlessNotFound();

  return useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await fetchPage(username, pageParam);
      const items = page.items.map((row) => withPendingFollow(queryClient, row));
      return items.some((row, index) => row !== page.items[index]) ? { ...page, items } : page;
    },
    initialPageParam: null,
    getNextPageParam,
    retry,
    enabled,
    // Refetch only when the list becomes visible, never on focus / reconnect while it's open: that
    // would drop a row just unfollowed (an open list keeps its rows).
    ...(alwaysFresh && { staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false }),
  });
}

// "Who to follow": up to 3 users the signed-in user doesn't follow, newest accounts first.
export function useSuggestions() {
  return useQuery({
    queryKey: followKeys.suggestions(),
    queryFn: fetchSuggestions,
  });
}

// Follow "bursts", per QueryClient and (lowercased) target username: the follow requests for a
// user that overlap in time (e.g. a fast double click). Same model as the like bursts in
// use-posts.js: `confirmed` is the last state the server is known to hold — the cached state when
// the burst started, replaced by every successful response that is newer (by click order) than the
// one it holds — and the caches are set to it when the burst's last request settles. `shown` is
// the state currently written into the caches (null when the burst started with nothing cached),
// which is what the caller's own `followingCount` has been moved to match.
const followBursts = new WeakMap();

function getFollowBursts(queryClient) {
  let bursts = followBursts.get(queryClient);
  if (!bursts) {
    bursts = new Map();
    followBursts.set(queryClient, bursts);
  }
  return bursts;
}

// Whether `burst` is still the live burst of `key` (false once `resetFollowBursts` ran).
const isLiveBurst = (queryClient, key, burst) => followBursts.get(queryClient)?.get(key) === burst;

// `user` (a profile or a list row: `{ username, isFollowing?, followerCount?, followingCount? }`)
// as a fetch of it should be cached while follow bursts are in flight. A response the server built
// before applying a burst's request would otherwise undo the optimistic state until (or, for the
// caller's own count, even after) the burst settles:
//   - a burst of `user` itself: its optimistic `isFollowing` (and `followerCount` moved by the
//     flip, when present). Once the burst settles the caches get the server-confirmed state anyway.
//   - the signed-in user's own profile: `followingCount` moved by the net optimistic delta of the
//     bursts they have in flight (±1 per burst whose shown state differs from its last confirmed
//     one). Whether the server had already applied a request can't be known here, so each of those
//     bursts is flagged `ownCountFetched` and refetches the caller's profile once it settles.
// Returns `user` untouched when nothing applies.
export function withPendingFollow(queryClient, user) {
  if (typeof user?.username !== 'string') return user;
  const key = user.username.toLowerCase();
  const bursts = followBursts.get(queryClient);
  if (!bursts) return user;
  let result = user;

  const burst = bursts.get(key);
  const following = burst?.shown ?? null;
  if (following !== null && typeof user.isFollowing === 'boolean' && user.isFollowing !== following) {
    const { followerCount } = user;
    result = {
      ...result,
      isFollowing: following,
      ...(typeof followerCount === 'number' && {
        followerCount: Math.max(0, followerCount + (following ? 1 : -1)),
      }),
    };
  }

  let delta = 0;
  for (const own of bursts.values()) {
    if (own.me?.toLowerCase() !== key) continue;
    own.ownCountFetched = true;
    if (own.shown !== null && own.confirmed && own.shown !== own.confirmed.following) {
      delta += own.shown ? 1 : -1;
    }
  }
  if (delta !== 0 && typeof user.followingCount === 'number') {
    result = { ...result, followingCount: Math.max(0, user.followingCount + delta) };
  }
  return result;
}

// Forgets every follow burst of `queryClient`. Called on sign-out (AuthProvider) next to the cache
// clearing, so a follow still in flight from the previous session can't write into the next user's
// cache.
export function resetFollowBursts(queryClient) {
  followBursts.delete(queryClient);
}

// Moves every cached copy of `username`'s follow state to `following`: their profile
// (`isFollowing`, `followerCount` — the server's `followerCount` when given), their list/suggestion
// rows, and the caller's `followingCount` by the flip relative to `burst.shown`.
function writeFollowState(queryClient, username, burst, following, followerCount = null) {
  setFollowInProfile(queryClient, username, following, followerCount);
  setFollowingInLists(queryClient, username, following);
  if (burst.me && burst.shown !== null && burst.shown !== following) {
    bumpProfileFollowingCount(queryClient, burst.me, following ? 1 : -1);
  }
  burst.shown = following;
}

// `mutate({ username, following })` where `following` is the intended final state
// (`!user.isFollowing`). The request is PUT (follow) or DELETE (unfollow) — idempotent, so rapid
// clicks just send the latest intent. Optimistic: in-flight fetches of the affected entries are
// cancelled, then the target's profile (`isFollowing`, `followerCount`), the signed-in user's
// profile (`followingCount`) and every loaded list/suggestion row of the target flip. When the last
// request of the burst settles, the caches get the server-confirmed state (see `followBursts`) —
// the target's `followerCount` is the server's — after cancelling any fetch still in flight, so
// neither a failed request nor a stale refetch leaves a wrong state. If any request succeeded, the
// Following feed and the suggestions are refetched, and the target's followers / the caller's
// following lists are marked stale (not refetched: an open list keeps its rows, like Twitter).
export function useToggleFollow() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const me = user?.username ?? null;

  return useMutation({
    mutationFn: ({ username, following }) => setFollowing(username, following),
    onMutate: async ({ username, following }) => {
      const key = username.toLowerCase();
      const bursts = getFollowBursts(queryClient);
      let burst = bursts.get(key);
      if (!burst) {
        const state = findFollowState(queryClient, username);
        burst = {
          seq: 0,
          pending: 0,
          confirmedSeq: 0,
          confirmed: state,
          shown: state ? state.following : null,
          // The caller's own count can only be moved when the starting state is known.
          ownCountKnown: state !== null,
          // Set when the caller's own profile is fetched while this burst is live.
          ownCountFetched: false,
          succeeded: false,
          me: me && me.toLowerCase() !== key ? me : null,
        };
        bursts.set(key, burst);
      }
      burst.seq += 1;
      burst.pending += 1;
      const seq = burst.seq;

      await cancelLoadedFetches(queryClient, followQueryFilters(username, burst.me));
      if (isLiveBurst(queryClient, key, burst)) {
        writeFollowState(queryClient, username, burst, following);
      }
      return { seq, burst };
    },
    onSettled: (result, error, { username }, context) => {
      const key = username.toLowerCase();
      const burst = context?.burst;
      if (!burst || !isLiveBurst(queryClient, key, burst)) return undefined;

      if (!error) {
        burst.succeeded = true;
        if (context.seq > burst.confirmedSeq) {
          burst.confirmed = { following: result.following, followerCount: result.followerCount };
          burst.confirmedSeq = context.seq;
        }
      }
      burst.pending -= 1;
      if (burst.pending > 0) return undefined;

      return writeAfterServerChange(queryClient, followQueryFilters(username, burst.me), () => {
        // A new click during the cancel joined this burst; its own settle will finish it.
        if (burst.pending > 0 || !isLiveBurst(queryClient, key, burst)) return;
        followBursts.get(queryClient).delete(key);

        if (burst.confirmed) {
          const { following, followerCount } = burst.confirmed;
          writeFollowState(queryClient, username, burst, following, followerCount);
        } else {
          // Nothing was cached when the burst began and no request succeeded: refetch it.
          queryClient.invalidateQueries({ queryKey: profileQueryKey(username), exact: true });
          queryClient.invalidateQueries({ queryKey: followKeys.all });
        }
        // The caller's own count can't be trusted when it started unknown, or when their profile
        // was fetched mid-burst (see `withPendingFollow`): take the server's.
        if (burst.me && (!burst.ownCountKnown || burst.ownCountFetched)) {
          queryClient.invalidateQueries({ queryKey: profileQueryKey(burst.me), exact: true });
        }

        if (burst.succeeded) {
          queryClient.invalidateQueries({ queryKey: postKeys.feed(), exact: true });
          queryClient.invalidateQueries({ queryKey: followKeys.suggestions(), exact: true });
          queryClient.invalidateQueries({
            queryKey: followKeys.followers(username),
            exact: true,
            refetchType: 'none',
          });
          if (burst.me) {
            queryClient.invalidateQueries({
              queryKey: followKeys.following(burst.me),
              exact: true,
              refetchType: 'none',
            });
          }
        }
      });
    },
  });
}
