import { Composer } from '@/components/feed/Composer';
import { InfiniteListFooter } from '@/components/feed/InfiniteListFooter';
import { PostCard } from '@/components/feed/PostCard';
import { PostListSkeleton } from '@/components/feed/PostListSkeleton';
import { ComingSoon } from '@/components/layout/ComingSoon';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useFeed } from '@/hooks/use-posts';
import { focusComposer } from '@/lib/composer-focus';
import { cn } from '@/lib/utils';
import { Feather } from 'lucide-react';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

const tabClassName = 'relative flex-1 py-3 text-sm font-medium outline-none transition focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50';

// Only "For you" exists, so the tabs are plain markup with tab semantics (no switching); the
// "Following" tab is a "Coming soon" placeholder. Radix Tabs isn't used: its triggers activate on
// focus/mousedown, which ComingSoon can't block without making the tooltip unreachable.
function FeedTabs() {
  return (
    <div role="tablist" aria-label="Feed" className="flex">
      <button type="button" role="tab" id="feed-tab-for-you" aria-selected="true" aria-controls="feed-panel" className={tabClassName}>
        <span className="text-foreground">For you</span>
        <span aria-hidden="true" className="absolute bottom-0 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-primary" />
      </button>
      <ComingSoon side="bottom">
        <button type="button" role="tab" aria-selected="false" className={cn(tabClassName, 'text-muted-foreground')}>
          Following
        </button>
      </ComingSoon>
    </div>
  );
}

// "New post" from elsewhere navigates here with `state.focusComposer` (see useOpenComposer): focus
// the composer once it's rendered, then drop that state so a reload or Back doesn't refocus it.
function useFocusComposerFromNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const shouldFocus = Boolean(location.state?.focusComposer);

  useEffect(() => {
    if (!shouldFocus) return;
    focusComposer();
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [shouldFocus, navigate, location.pathname, location.search, location.hash]);
}

// The feed below the composer: loading skeletons, an error with Retry, an empty state, or the
// posts (newest first) with infinite scroll and "You're all caught up" at the end.
function Feed() {
  const feed = useFeed();

  if (feed.isPending) return <PostListSkeleton />;

  if (feed.isError && !feed.data) {
    return (
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-6">
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load your feed. Check your connection and try again.</AlertDescription>
        </Alert>
        <Button onClick={() => feed.refetch()} disabled={feed.isFetching} className="self-start rounded-full px-5 font-semibold">
          {feed.isFetching && <Spinner aria-hidden="true" />}
          Retry
        </Button>
      </div>
    );
  }

  const posts = feed.data.pages.flatMap((page) => page.items);

  if (posts.length === 0) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-16 text-center">
        <Feather className="size-6 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-semibold">No posts yet</h2>
        <p className="text-sm text-balance text-muted-foreground">
          Your posts and posts from people you follow will show up here. Write your first one above.
        </p>
      </div>
    );
  }

  return (
    <>
      <h2 className="sr-only">Posts</h2>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      <InfiniteListFooter
        query={feed}
        endMessage="You're all caught up"
        errorMessage="Couldn't load more posts. Check your connection and try again."
      />
    </>
  );
}

// The home feed: header with tabs, the composer and the feed.
export function Home() {
  useFocusComposerFromNavigation();

  return (
    <>
      <PageHeader title="Home" trailing={<span className="text-sm text-muted-foreground">created by Alejandro Gomez</span>}>
        <FeedTabs />
      </PageHeader>

      <div id="feed-panel" role="tabpanel" aria-labelledby="feed-tab-for-you">
        <div className="border-b border-border">
          <Composer />
        </div>

        <Feed />
      </div>
    </>
  );
}
