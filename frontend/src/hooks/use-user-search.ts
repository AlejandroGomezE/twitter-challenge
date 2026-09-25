import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { withPendingFollow } from '@/hooks/use-follows';
import { getNextPageParam } from '@/hooks/use-posts';
import { useRetryUnlessNotFound } from '@/hooks/use-retry-unless-not-found';
import { ApiError } from '@/lib/api/client';
import { normalizeSearchQuery, searchKeys, searchUsers } from '@/lib/api/search';

// How long the typeahead waits after the last keystroke before searching.
export const TYPEAHEAD_DEBOUNCE_MS = 250;
// Rows in the typeahead dropdown / per Explore page.
export const TYPEAHEAD_LIMIT = 5;
export const SEARCH_PAGE_LIMIT = 20;

// A 400 (invalid query) is as final as a 404: neither is retried; anything else falls back to the
// QueryClient's default policy.
function useSearchRetry() {
  const retryUnlessNotFound = useRetryUnlessNotFound();
  return (failureCount: number, error: Error) =>
    error instanceof ApiError && error.status === 400
      ? false
      : retryUnlessNotFound(failureCount, error);
}

// Fetches one page of results, with each row's follow state as the follow bursts in flight left it
// (`withPendingFollow`), so a page landing mid-toggle can't undo the optimistic state.
function useFetchSearchPage() {
  const queryClient = useQueryClient();
  return async (query: string, options?: Parameters<typeof searchUsers>[1]) => {
    const page = await searchUsers(query, options);
    const items = page.items.map((row) => withPendingFollow(queryClient, row));
    return items.some((row, index) => row !== page.items[index]) ? { ...page, items } : page;
  };
}

// The right-rail typeahead: up to `TYPEAHEAD_LIMIT` users matching `rawQuery` (the input as typed),
// searched `TYPEAHEAD_DEBOUNCE_MS` after the last change. Disabled (no request, no data) while the
// normalized query is empty (blank or `@`-only input). While the next query loads, the previous
// results stay on screen (`isPlaceholderData` is true meanwhile). Data = `{ items, nextCursor }`.
export function useUserTypeahead(rawQuery: string) {
  const debounced = useDebouncedValue(rawQuery, TYPEAHEAD_DEBOUNCE_MS);
  const { query, searchable } = normalizeSearchQuery(debounced);
  const fetchPage = useFetchSearchPage();
  const retry = useSearchRetry();

  return useQuery({
    queryKey: searchKeys.userResults(query, 'typeahead'),
    queryFn: () => fetchPage(query, { limit: TYPEAHEAD_LIMIT }),
    enabled: searchable,
    // Only between two searchable queries: clearing the input shouldn't keep showing results.
    placeholderData: searchable ? keepPreviousData : undefined,
    retry,
  });
}

// Explore's full results for `rawQuery`: every matching user, ordered by username, paged by cursor
// (`SEARCH_PAGE_LIMIT` per page). Not debounced (the page decides when the query changes).
// Disabled while the normalized query is empty.
export function useUserSearch(rawQuery: string) {
  const { query, searchable } = normalizeSearchQuery(rawQuery);
  const fetchPage = useFetchSearchPage();
  const retry = useSearchRetry();

  return useInfiniteQuery({
    queryKey: searchKeys.userResults(query, 'all'),
    queryFn: ({ pageParam }) => fetchPage(query, { cursor: pageParam, limit: SEARCH_PAGE_LIMIT }),
    initialPageParam: null as string | null,
    getNextPageParam,
    enabled: searchable,
    retry,
  });
}
