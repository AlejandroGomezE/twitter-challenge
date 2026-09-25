import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

// How far below the viewport the sentinel starts loading the next page.
const ROOT_MARGIN = '0px 0px 400px 0px';

const supportsIntersectionObserver = () => typeof IntersectionObserver !== 'undefined';

// The footer of a cursor-paged list (feed, a profile's posts, comments). Pass the
// `useInfiniteQuery` result as `query`. While there are more pages it renders:
//   - an IntersectionObserver sentinel that loads the next page when it gets within 400px of the
//     viewport (skipped where IntersectionObserver doesn't exist, e.g. jsdom);
//   - a "Load more" button — the keyboard / screen-reader path and the fallback without IO;
//   - a spinner in that button while the next page loads, or `errorMessage` with a Retry button if
//     it failed (a failed page is never re-requested automatically, only through Retry).
// At the end it renders `endMessage` (if given).
//
// Auto-loading, without double fetches or stalls:
//   - the observer is armed only while the query isn't fetching at all (no next page, no refetch —
//     e.g. a window-focus refetch or a restart after a write), and `fetchNextPage` is called with
//     `cancelRefetch: false`, which joins a fetch already in flight instead of restarting it;
//   - when it fires it stops watching until the request it triggered settles, then watches again —
//     re-observing reports the current intersection, so if the sentinel is still in view it loads
//     the next page. This covers a sentinel that fired while a refetch had started but React hadn't
//     re-rendered yet: its `fetchNextPage` only joined the refetch, and without re-observing nothing
//     would ever load page 2 (a refetch that starts and ends between renders never changes
//     `isFetching` as React sees it, so the effect wouldn't re-arm either);
//   - a short page keeps loading until the list fills the viewport; it stops at the last page or at
//     a failed page (only Retry re-requests it), so there's no endless loop.
// The parts of a `useInfiniteQuery` result the footer reads (any page type fits).
export type InfiniteListQuery = Pick<
  UseInfiniteQueryResult<InfiniteData<unknown>>,
  'hasNextPage' | 'isFetching' | 'isFetchingNextPage' | 'isFetchNextPageError' | 'fetchNextPage'
>;

export interface InfiniteListFooterProps {
  query: InfiniteListQuery;
  endMessage?: ReactNode;
  loadMoreLabel?: string;
  errorMessage?: ReactNode;
}

export function InfiniteListFooter({
  query,
  endMessage,
  loadMoreLabel = 'Load more',
  errorMessage = "Couldn't load more. Check your connection and try again.",
}: InfiniteListFooterProps) {
  const { hasNextPage, isFetching, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  const sentinelRef = useRef<HTMLDivElement>(null);
  // `isFetching` covers any fetch of the query, not only a next page: a sentinel firing during a
  // refetch would just join it and never load the next page, so the observer waits for it to end.
  const canAutoLoad = Boolean(hasNextPage) && !isFetching && !isFetchNextPageError;
  const showError = isFetchNextPageError && !isFetchingNextPage;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!canAutoLoad || !sentinel || !supportsIntersectionObserver()) return undefined;

    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        // Stop watching until this request settles, then look again (see above).
        observer.unobserve(sentinel);
        fetchNextPage({ cancelRefetch: false }).then((result) => {
          if (!active || !result.hasNextPage || result.isFetchNextPageError) return;
          observer.observe(sentinel);
        });
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(sentinel);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [canAutoLoad, fetchNextPage]);

  function loadMore() {
    // Also Retry after a failed page (the observer stays off then, so it's never auto-retried).
    if (!hasNextPage || isFetchingNextPage) return;
    fetchNextPage({ cancelRefetch: false });
  }

  if (!hasNextPage) {
    return endMessage ? (
      <p className="px-6 py-8 text-center font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
        {endMessage}
      </p>
    ) : null;
  }

  return (
    <div ref={sentinelRef} className="flex flex-col items-center gap-3 px-5 py-6 sm:px-6">
      {showError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      {/* One button for Load more / Loading / Retry, aria-disabled (not disabled) while loading, so
          keyboard focus stays on it across the states. */}
      <Button
        variant="outline"
        onClick={loadMore}
        aria-disabled={isFetchingNextPage || undefined}
        className="rounded-full px-5 font-semibold aria-disabled:opacity-70"
      >
        {isFetchingNextPage && <Spinner aria-hidden="true" />}
        {isFetchingNextPage ? 'Loading…' : showError ? 'Retry' : loadMoreLabel}
      </Button>
    </div>
  );
}
