import { useQuery } from '@tanstack/react-query';
import { useRetryUnlessNotFound } from '@/hooks/use-retry-unless-not-found';
import { fetchProfile, profileQueryKey } from '@/lib/api/users';

// Loads a user's public profile. A 404 (unknown username) is final, so it is never retried; any
// other failure falls back to the QueryClient's default retry policy.
export function useProfile(username) {
  const retry = useRetryUnlessNotFound();

  return useQuery({
    queryKey: profileQueryKey(username),
    queryFn: () => fetchProfile(username),
    retry,
  });
}
