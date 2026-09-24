import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { fetchProfile, profileQueryKey } from '@/lib/api/users';

const isNotFound = (error) => error instanceof ApiError && error.status === 404;

// Loads a user's public profile. A 404 (unknown username) is final, so it is never retried; any
// other failure falls back to the QueryClient's default retry policy.
export function useProfile(username) {
  const queryClient = useQueryClient();
  const defaultRetry = queryClient.getDefaultOptions().queries?.retry;

  return useQuery({
    queryKey: profileQueryKey(username),
    queryFn: () => fetchProfile(username),
    retry: (failureCount, error) => {
      if (isNotFound(error)) return false;
      if (typeof defaultRetry === 'function') return defaultRetry(failureCount, error);
      if (typeof defaultRetry === 'number') return failureCount < defaultRetry;
      return defaultRetry ?? failureCount < 3;
    },
  });
}
