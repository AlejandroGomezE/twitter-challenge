import { useQuery, useQueryClient } from '@tanstack/react-query';
import { withPendingFollow } from '@/hooks/use-follows';
import { useRetryUnlessNotFound } from '@/hooks/use-retry-unless-not-found';
import { fetchProfile, profileQueryKey } from '@/lib/api/users';

// Loads a user's public profile. A 404 (unknown username) is final, so it is never retried; any
// other failure falls back to the QueryClient's default retry policy. A response that lands while
// a follow of that user is still in flight keeps the optimistic follow state (`withPendingFollow`).
//
// `alwaysFresh: true` (the profile page) makes this observer treat the cache as always stale
// (`staleTime: 0`), so it refetches on every mount and on every `username` change — including back
// to a profile cached moments ago — while the cached profile stays on screen. Other callers keep
// the QueryClient's default staleTime.
export function useProfile(username, { alwaysFresh = false } = {}) {
  const queryClient = useQueryClient();
  const retry = useRetryUnlessNotFound();

  return useQuery({
    queryKey: profileQueryKey(username),
    queryFn: async () => withPendingFollow(queryClient, await fetchProfile(username)),
    retry,
    ...(alwaysFresh && { staleTime: 0 }),
  });
}
