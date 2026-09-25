import { mapPages, profileQueryFilters } from '@/lib/api/post-cache';
import { followKeys, profileQueryKey } from '@/lib/api/users';

// Cache helpers for the follow mutation, so "change a user's follow state everywhere it's cached"
// lives in one place. A user's follow state can be cached in:
//   - their profile `profileQueryKey(username)` — `isFollowing` + `followerCount`;
//   - the signed-in user's own profile — `followingCount`;
//   - every followers / following list under `followKeys.lists()` — infinite `{ pages, pageParams }`
//     whose rows are `FollowUser`s (`isFollowing`);
//   - the suggestions `followKeys.suggestions()` — `{ items: FollowUser[] }`.
// The race rules are post-cache.js's (`cancelLoadedFetches` / `writeAfterServerChange`); these
// filters are what to pass them. Every helper returns the previous object untouched when nothing
// changed, so unrelated observers don't re-render.

const sameUser = (a, b) => a.toLowerCase() === b.toLowerCase();

// Filters for every cache entry a follow of `username` by `me` can touch: the target's profile,
// the caller's profile (when known) and every follow listing.
export const followQueryFilters = (username, me) => [
  ...profileQueryFilters(username),
  ...(me ? profileQueryFilters(me) : []),
  { queryKey: followKeys.all },
];

// The last known follow state of `username` — `{ following, followerCount }` from their profile,
// else `{ following, followerCount: null }` from any listed row — or null when it isn't cached.
export function findFollowState(queryClient, username) {
  const profile = queryClient.getQueryData(profileQueryKey(username));
  if (typeof profile?.isFollowing === 'boolean') {
    return {
      following: profile.isFollowing,
      followerCount: typeof profile.followerCount === 'number' ? profile.followerCount : null,
    };
  }
  const suggestions = queryClient.getQueryData(followKeys.suggestions());
  const lists = queryClient.getQueriesData({ queryKey: followKeys.lists() }).map(([, data]) => data);
  const rowSets = [
    suggestions?.items ?? [],
    ...lists.flatMap((data) => (data?.pages ?? []).map((page) => page.items)),
  ];
  for (const rows of rowSets) {
    const row = rows.find((item) => sameUser(item.username, username));
    if (row) return { following: row.isFollowing, followerCount: null };
  }
  return null;
}

// Sets `isFollowing` on `username`'s loaded profile. Its `followerCount` becomes `followerCount`
// when given (the server's value), else moves by ±1 when the state actually flips.
export function setFollowInProfile(queryClient, username, following, followerCount = null) {
  queryClient.setQueryData(profileQueryKey(username), (profile) => {
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

// Sets `isFollowing` on every loaded row of `username` (followers / following lists, suggestions).
export function setFollowingInLists(queryClient, username, following) {
  const mapRows = (items) => {
    if (!items.some((item) => sameUser(item.username, username) && item.isFollowing !== following)) {
      return items;
    }
    return items.map((item) =>
      sameUser(item.username, username) ? { ...item, isFollowing: following } : item,
    );
  };
  queryClient.setQueriesData({ queryKey: followKeys.lists() }, (data) => mapPages(data, mapRows));
  queryClient.setQueryData(followKeys.suggestions(), (data) => {
    if (!data?.items) return data;
    const items = mapRows(data.items);
    return items === data.items ? data : { ...data, items };
  });
}

// Adds `delta` to a loaded profile's `followingCount` (never below 0).
export function bumpProfileFollowingCount(queryClient, username, delta) {
  queryClient.setQueryData(profileQueryKey(username), (profile) =>
    profile && typeof profile.followingCount === 'number'
      ? { ...profile, followingCount: Math.max(0, profile.followingCount + delta) }
      : profile,
  );
}
