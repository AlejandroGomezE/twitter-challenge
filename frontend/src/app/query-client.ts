import { ApiError } from '@/lib/api/client';
import { AUTH_ME_QUERY_KEY, isAuthMeQuery } from '@/lib/auth/auth-context';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  type DefaultOptions,
} from '@tanstack/react-query';

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

// Builds the app's QueryClient. A 401 from any query or mutation means the session expired, so the
// cached user is reset to `null` centrally (ProtectedRoute then redirects to /sign-in) and every
// other cached query is dropped, so no signed-in data survives into a later sign-in by another user.
// The `me` query itself is kept (AuthProvider observes it and handles its own 401 as `null`).
export interface CreateQueryClientOptions {
  // Overrides of the app's query defaults (e.g. no retries in tests).
  queries?: DefaultOptions['queries'];
}

export function createQueryClient({ queries }: CreateQueryClientOptions = {}) {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isUnauthorized(error) && !isAuthMeQuery(query)) handleSessionExpired();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isUnauthorized(error)) handleSessionExpired();
      },
    }),
    defaultOptions: {
      queries: {
        // Retrying a 401 cannot succeed; other failures get one retry.
        retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 1,
        staleTime: 30_000,
        ...queries,
      },
    },
  });

  function handleSessionExpired() {
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, null);
    queryClient.removeQueries({ predicate: (query) => !isAuthMeQuery(query) });
  }

  return queryClient;
}
