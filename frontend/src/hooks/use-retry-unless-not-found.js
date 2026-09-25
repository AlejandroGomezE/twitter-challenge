import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';

const isNotFound = (error) => error instanceof ApiError && error.status === 404;

// A query `retry` policy for lookups where a 404 is final (unknown user, deleted post): a 404 is
// never retried; any other failure falls back to the QueryClient's default retry policy.
export function useRetryUnlessNotFound() {
  const queryClient = useQueryClient();
  const defaultRetry = queryClient.getDefaultOptions().queries?.retry;

  return (failureCount, error) => {
    if (isNotFound(error)) return false;
    if (typeof defaultRetry === 'function') return defaultRetry(failureCount, error);
    if (typeof defaultRetry === 'number') return failureCount < defaultRetry;
    return defaultRetry ?? failureCount < 3;
  };
}
