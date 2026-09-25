import type { InfiniteData, QueryClient, QueryFilters } from '@tanstack/react-query';
import { mapPages, profileQueryFilters } from '@/lib/api/post-cache';
import { searchKeys } from '@/lib/api/search';
import type { FollowUser, Page, Profile } from '@/lib/api/types';
import { followKeys, profileQueryKey } from '@/lib/api/users';

// Cache helpers for the follow mutation, so "change a user's follow state everywhere it's cached"
// lives in one place. A user's follow state can be cached in:
//   - their profile `profileQueryKey(username)` — `isFollowing` + `followerCount`;
//   - the signed-in user's own profile — `followingCount`;
//   - every followers / following list under `followKeys.lists()` — infinite `{ pages, pageParams }`
//     whose rows are `FollowUser`s (`isFollowing`);
//   - the suggestions `followKeys.suggestions()` — `{ items: FollowUser[] }`;
//   - every user search result under `searchKeys.all` — the typeahead's single page
//     `{ items: FollowUser[], nextCursor }` or Explore's infinite `{ pages, pageParams }`.
// The race rules are post-cache.ts's (`cancelLoadedFetches` / `writeAfterServerChange`); these
// filters are what to pass them. Every helper returns the previous object untouched when nothing
// changed, so unrelated observers don't re-render.

// A cached followers / following list (an infinite query of `FollowUser` pages).
type FollowListData = InfiniteData<Page<FollowUser>>;
// The suggestions entry: a single `{ items }` page.
type SuggestionsData = Pick<Page<FollowUser>, 'items'>;
// A cached search result: the typeahead's single page or Explore's infinite query.
type SearchData = FollowListData | Page<FollowUser>;

// The last known follow state of a user (`followerCount` is null when only a listed row is known).
export interface CachedFollowState {
  following: boolean;
  followerCount: number | null;
}

const isInfinite = (data?: SearchData): data is FollowListData =>
  Boolean(data && 'pages' in data && data.pages);

const sameUser = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Filters for every cache entry a follow of `username` by `me` can touch: the target's profile,
// the caller's profile (when known), every follow listing and every search result.
export const followQueryFilters = (username: string, me?: string | null): QueryFilters[] => [
  ...profileQueryFilters(username),
  ...(me ? profileQueryFilters(me) : []),
  { queryKey: followKeys.all },
  { queryKey: searchKeys.all },
];

// The row arrays of a cached listing: an infinite query's pages, or a single `{ items }` page.
const rowsOf = (data?: SearchData): FollowUser[][] => {
  if (isInfinite(data)) return data.pages.map((page) => page.items);
  return data?.items ? [data.items] : [];
};

// The last known follow state of `username` — `{ following, followerCount }` from their profile,
// else `{ following, followerCount: null }` from any listed row — or null when it isn't cached.
export function findFollowState(
  queryClient: QueryClient,
  username: string,
): CachedFollowState | null {
  const profile = queryClient.getQueryData<Profile>(profileQueryKey(username));
  if (typeof profile?.isFollowing === 'boolean') {
    return {
      following: profile.isFollowing,
      followerCount: typeof profile.followerCount === 'number' ? profile.followerCount : null,
    };
  }
  const suggestions = queryClient.getQueryData<SuggestionsData>(followKeys.suggestions());
  const lists = queryClient
    .getQueriesData<FollowListData>({ queryKey: followKeys.lists() })
    .map(([, data]) => data);
  const searches = queryClient
    .getQueriesData<SearchData>({ queryKey: searchKeys.all })
    .map(([, data]) => data);
  const rowSets = [
    suggestions?.items ?? [],
    ...lists.flatMap((data) => (data?.pages ?? []).map((page) => page.items)),
    ...searches.flatMap(rowsOf),
  ];
  for (const rows of rowSets) {
    const row = rows.find((item) => sameUser(item.username, username));
    if (row) return { following: row.isFollowing, followerCount: null };
  }
  return null;
}

// Sets `isFollowing` on `username`'s loaded profile. Its `followerCount` becomes `followerCount`
// when given (the server's value), else moves by ±1 when the state actually flips.
export function setFollowInProfile(
  queryClient: QueryClient,
  username: string,
  following: boolean,
  followerCount: number | null = null,
) {
  queryClient.setQueryData<Profile>(profileQueryKey(username), (profile) => {
    if (!profile) return profile;
    let count = profile.followerCount;
    if (typeof followerCount === 'number') {
      count = followerCount;
    } else if (typeof count === 'number' && profile.isFollowing !== following) {
      count = Math.max(0, count + (following ? 1 : -1));
    }
    if (profile.isFollowing === following && profile.followerCount === count) return profile;
    return { ...profile, isFollowing: following, followerCount: count };
  });
}

// Sets `isFollowing` on every loaded row of `username` (followers / following lists, suggestions,
// search results).
export function setFollowingInLists(queryClient: QueryClient, username: string, following: boolean) {
  const mapRows = (items: FollowUser[]) => {
    if (!items.some((item) => sameUser(item.username, username) && item.isFollowing !== following)) {
      return items;
    }
    return items.map((item) =>
      sameUser(item.username, username) ? { ...item, isFollowing: following } : item,
    );
  };
  queryClient.setQueriesData<FollowListData>({ queryKey: followKeys.lists() }, (data) =>
    mapPages(data, mapRows),
  );
  const mapSinglePage = <D extends SuggestionsData>(data?: D): D | undefined => {
    if (!data?.items) return data;
    const items = mapRows(data.items);
    return items === data.items ? data : { ...data, items };
  };
  queryClient.setQueryData<SuggestionsData>(followKeys.suggestions(), (data) => mapSinglePage(data));
  queryClient.setQueriesData<SearchData>({ queryKey: searchKeys.all }, (data?: SearchData) =>
    isInfinite(data) ? mapPages(data, mapRows) : mapSinglePage(data),
  );
}

// Adds `delta` to a loaded profile's `followingCount` (never below 0).
export function bumpProfileFollowingCount(queryClient: QueryClient, username: string, delta: number) {
  queryClient.setQueryData<Profile>(profileQueryKey(username), (profile) =>
    profile && typeof profile.followingCount === 'number'
      ? { ...profile, followingCount: Math.max(0, profile.followingCount + delta) }
      : profile,
  );
}
