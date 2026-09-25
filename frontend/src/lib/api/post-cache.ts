import type {
  InfiniteData,
  Query,
  QueryClient,
  QueryFilters,
  QueryKey,
} from '@tanstack/react-query';
import { postKeys } from '@/lib/api/posts';
import type { LikeState, Page, Post, Profile } from '@/lib/api/types';
import { profileQueryKey } from '@/lib/api/users';

// Cache helpers shared by the post / like / comment mutations, so "change a post everywhere it's
// cached" lives in one place. A post can be cached in:
//   - every infinite list under `postKeys.lists()` (the Following and For you feeds, any user's
//     posts) — `{ pages, pageParams }`
//     with `pages[i] = { items, nextCursor }`;
//   - its detail entry `postKeys.detail(id)`.
// Every helper returns the previous object untouched when nothing changed, so unrelated
// observers don't re-render.

// --- Races with in-flight fetches -----------------------------------------------------------
// A list/detail fetch that started before the server applied a write can land after we wrote
// the result into the cache and silently undo it (a new post vanishes, a deleted one comes back,
// a like flips back). Two helpers close that gap:
//   - `cancelLoadedFetches` (before an optimistic write): cancels in-flight fetches of queries
//     that already have data; a cancelled fetch reverts the query to its previous data, so the
//     optimistic write sticks. Initial loads (no data yet) are left alone — cancelling one would
//     leave it pending with nothing fetching.
//   - `writeAfterServerChange` (once the server has answered): cancels every in-flight fetch of
//     those queries (they may carry pre-write data), applies `write()`, then restarts the
//     cancelled initial loads — any fetch started from here on sees the server's new state.
// Cancelling also drops a "load more" (`fetchNextPage`) that was in flight: the list reverts to
// the pages it had and the next "load more" / scroll fetches that page again. That's the price
// of a cache that always ends up matching the server.

// A cached post list (an infinite query of post pages).
export type PostListData = InfiniteData<Page<Post>>;

// `filtersList` is an array of TanStack query filters (`{ queryKey, exact? }`).
const findQueries = (
  queryClient: QueryClient,
  filtersList: QueryFilters[],
  predicate: (query: Query) => boolean,
) =>
  filtersList.flatMap((filters) => queryClient.getQueryCache().findAll({ ...filters, predicate }));

const isFetching = (query: Query) => query.state.fetchStatus === 'fetching';

const cancelQuery = (queryClient: QueryClient, query: Query) =>
  queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });

export async function cancelLoadedFetches(queryClient: QueryClient, filtersList: QueryFilters[]) {
  const loaded = findQueries(
    queryClient,
    filtersList,
    (query) => isFetching(query) && query.state.data !== undefined,
  );
  await Promise.all(loaded.map((query) => cancelQuery(queryClient, query)));
}

export async function writeAfterServerChange(
  queryClient: QueryClient,
  filtersList: QueryFilters[],
  write: () => void,
) {
  const inFlight = findQueries(queryClient, filtersList, isFetching);
  await Promise.all(inFlight.map((query) => cancelQuery(queryClient, query)));
  write();
  for (const query of inFlight) {
    if (query.state.data === undefined) {
      queryClient.refetchQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

// Filters for every cache entry that can hold post `id` (all lists + its detail).
export const postQueryFilters = (id: string): QueryFilters[] => [
  { queryKey: postKeys.lists() },
  { queryKey: postKeys.detail(id), exact: true },
];

// Filter for a user's profile entry (it carries `postCount`).
export const profileQueryFilters = (username: string): QueryFilters[] => [
  { queryKey: profileQueryKey(username), exact: true },
];

// First cached copy of post `id` (its detail entry, else any list), or undefined.
export function findPostInCaches(queryClient: QueryClient, id: string): Post | undefined {
  const detail = queryClient.getQueryData<Post>(postKeys.detail(id));
  if (detail) return detail;
  for (const [, data] of queryClient.getQueriesData<PostListData>({ queryKey: postKeys.lists() })) {
    for (const page of data?.pages ?? []) {
      const post = page.items.find((item) => item.id === id);
      if (post) return post;
    }
  }
  return undefined;
}

// Maps the items of every page of an infinite-query result; `undefined` (not loaded) passes through.
// `mapItems` returns its input untouched when nothing changed. Shared with follow-cache.ts.
export function mapPages<T, TPageParam = unknown>(
  data: InfiniteData<Page<T>, TPageParam> | undefined,
  mapItems: (items: T[]) => T[],
): InfiniteData<Page<T>, TPageParam> | undefined {
  if (!data?.pages) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const items = mapItems(page.items);
    if (items === page.items) return page;
    changed = true;
    return { ...page, items };
  });
  return changed ? { ...data, pages } : data;
}

// Applies `updater(post) → post` to post `id` in every list and in its detail entry.
export function updatePostInCaches(
  queryClient: QueryClient,
  id: string,
  updater: (post: Post) => Post,
) {
  queryClient.setQueriesData<PostListData>({ queryKey: postKeys.lists() }, (data) =>
    mapPages(data, (items) => {
      if (!items.some((post) => post.id === id)) return items;
      return items.map((post) => (post.id === id ? updater(post) : post));
    }),
  );
  queryClient.setQueryData<Post>(postKeys.detail(id), (post) => (post ? updater(post) : post));
}

// Drops post `id` from every list (its detail and comments entries are left alone).
export function removePostFromLists(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<PostListData>({ queryKey: postKeys.lists() }, (data) =>
    mapPages(data, (items) =>
      items.some((post) => post.id === id) ? items.filter((post) => post.id !== id) : items,
    ),
  );
}

// Drops post `id` from every list and removes its detail and comments entries.
export function removePostFromCaches(queryClient: QueryClient, id: string) {
  removePostFromLists(queryClient, id);
  queryClient.removeQueries({ queryKey: postKeys.detail(id), exact: true });
  queryClient.removeQueries({ queryKey: postKeys.comments(id), exact: true });
}

// Puts `post` at the top of the first page of the list at `queryKey`, only if that list is loaded
// (an unloaded list will fetch it anyway). Skips it if it's already there.
export function prependPostToList(queryClient: QueryClient, queryKey: QueryKey, post: Post) {
  queryClient.setQueryData<PostListData>(queryKey, (data) => {
    if (!data?.pages?.length) return data;
    if (data.pages.some((page) => page.items.some((item) => item.id === post.id))) return data;
    const [first, ...rest] = data.pages;
    return { ...data, pages: [{ ...first, items: [post, ...first.items] }, ...rest] };
  });
}

// Adds `delta` to a loaded profile's `postCount` (never below 0).
export function bumpProfilePostCount(queryClient: QueryClient, username: string, delta: number) {
  queryClient.setQueryData<Profile>(profileQueryKey(username), (profile) =>
    profile && typeof profile.postCount === 'number'
      ? { ...profile, postCount: Math.max(0, profile.postCount + delta) }
      : profile,
  );
}

// Adds `delta` to post `id`'s `commentCount` everywhere it's cached (never below 0).
export function bumpCommentCount(queryClient: QueryClient, id: string, delta: number) {
  updatePostInCaches(queryClient, id, (post) => ({
    ...post,
    commentCount: Math.max(0, post.commentCount + delta),
  }));
}

// Sets post `id`'s like state; a no-op for copies already in that state.
export function setLikeInCaches(
  queryClient: QueryClient,
  id: string,
  { liked, likeCount }: LikeState,
) {
  updatePostInCaches(queryClient, id, (post) =>
    post.likedByMe === liked && post.likeCount === likeCount
      ? post
      : { ...post, likedByMe: liked, likeCount },
  );
}
