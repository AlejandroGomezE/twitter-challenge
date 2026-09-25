import { InfiniteListFooter } from '@/components/feed/InfiniteListFooter';
import { FollowButton } from '@/components/FollowButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { UserName } from '@/components/UserName';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { TYPEAHEAD_DEBOUNCE_MS, useUserSearch } from '@/hooks/use-user-search';
import { normalizeSearchQuery } from '@/lib/api/search';
import { useAuth } from '@/lib/auth/use-auth';
import { Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';

// What the URL should hold for an input value: blank input = no `q` at all.
const toUrlQuery = (value) => (value.trim() ? value : '');

// The search query lives in the URL (`?q=`). The input is local state so typing stays instant; the
// URL follows it once typing has paused for `TYPEAHEAD_DEBOUNCE_MS`, replacing the history entry
// (keystrokes aren't pages to go Back through) and keeping the other search params, the hash and
// the router state. A `q` changed from outside (e.g. the rail's "See all results" while already on
// Explore) refills the input. Returns `[inputValue, setInputValue, q]`, `q` being the URL's query.
function useExploreQuery() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const q = searchParams.get('q') ?? '';

  const [value, setValue] = useState(q);
  const debounced = useDebouncedValue(value, TYPEAHEAD_DEBOUNCE_MS);
  const target = toUrlQuery(debounced);

  // An external `q` change (one we didn't write) replaces whatever is in the input.
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    if (q !== target) setValue(q);
  }

  useEffect(() => {
    // Only write once the input has settled, so a stale debounced value never overwrites a newer
    // (typed or external) one.
    if (debounced !== value || target === q) return;
    const params = new URLSearchParams(location.search);
    if (target) params.set('q', target);
    else params.delete('q');
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [debounced, value, target, q, navigate, location.pathname, location.search, location.hash, location.state]);

  return [value, setValue, q];
}

// Explore: a search box and every user matching the URL's `?q=` (by display name or username),
// ordered by username, with infinite scroll and a Follow button per row.
export function Explore() {
  const [value, setValue, q] = useExploreQuery();
  // Focus the box on arrival only when there's nothing searched yet (read once, on mount).
  const [autoFocus] = useState(() => !normalizeSearchQuery(q).searchable);

  return (
    <>
      <PageHeader title="Explore">
        <div role="search" className="px-5 pb-3 sm:px-6">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search users"
              placeholder="Search"
              autoFocus={autoFocus}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="h-11 rounded-full bg-secondary pl-10"
            />
          </div>
        </div>
      </PageHeader>

      <ExploreResults q={q} />
    </>
  );
}

// The results for `q`: a prompt without a query, skeleton rows while loading, an error with Retry,
// an empty state, or the rows followed by the infinite-scroll footer.
function ExploreResults({ q }) {
  const { query, searchable } = normalizeSearchQuery(q);
  const search = useUserSearch(q);
  const { user } = useAuth();
  const me = user?.username?.toLowerCase() ?? null;

  if (!searchable) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-16 text-center">
        <Search className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="font-semibold">Search for people by name or username</p>
      </div>
    );
  }

  if (search.isPending) return <ExploreSkeleton />;

  if (search.isError && !search.data) {
    return (
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-6">
        <Alert variant="destructive">
          <AlertDescription>
            Couldn't search users. Check your connection and try again.
          </AlertDescription>
        </Alert>
        <Button
          onClick={() => search.refetch()}
          disabled={search.isFetching}
          className="self-start rounded-full px-5 font-semibold"
        >
          {search.isFetching && <Spinner aria-hidden="true" />}
          Retry
        </Button>
      </div>
    );
  }

  const items = search.data.pages.flatMap((page) => page.items);

  if (items.length === 0) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-16 text-center">
        <Users className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="font-semibold break-words">No users match “{query}”</p>
      </div>
    );
  }

  return (
    <>
      <ul aria-label="Search results">
        {items.map((item) => (
          <ExploreRow
            key={item.username}
            item={item}
            isMe={me !== null && item.username.toLowerCase() === me}
          />
        ))}
      </ul>
      <InfiniteListFooter
        query={search}
        endMessage={`That's everyone matching “${query}”`}
        errorMessage="Couldn't load more users. Check your connection and try again."
      />
    </>
  );
}

// A result row. The whole row is clickable through the name link, stretched over the row with an
// `::after` overlay (a button can't live inside an `<a>`); the follow button sits above it.
function ExploreRow({ item, isMe }) {
  return (
    <li className="relative flex items-start gap-3 border-b border-border px-5 py-3 transition-colors hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50 sm:px-6">
      <UserAvatar username={item.username} size="lg" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <Link
          to={`/u/${encodeURIComponent(item.username)}`}
          className="block truncate text-sm outline-none after:absolute after:inset-0 hover:underline"
        >
          <UserName
            username={item.username}
            displayName={item.displayName}
            fallbackClassName="font-mono font-semibold"
          />
        </Link>
        {item.bio && (
          <p className="mt-0.5 line-clamp-2 text-sm break-words text-muted-foreground">
            {item.bio}
          </p>
        )}
      </div>
      {!isMe && (
        <FollowButton
          username={item.username}
          isFollowing={Boolean(item.isFollowing)}
          followsYou={Boolean(item.followsYou)}
          className="relative z-10 shrink-0"
        />
      )}
    </li>
  );
}

function ExploreSkeleton({ count = 5 }) {
  return (
    <div aria-busy="true">
      <Spinner className="sr-only" aria-label="Loading users" />
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-border px-5 py-3 sm:px-6">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}
