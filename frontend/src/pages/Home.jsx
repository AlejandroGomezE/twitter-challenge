import { Composer } from '@/components/feed/Composer';
import { InfiniteListFooter } from '@/components/feed/InfiniteListFooter';
import { PostCard } from '@/components/feed/PostCard';
import { PostListSkeleton } from '@/components/feed/PostListSkeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { usePostRemovalFocus } from '@/hooks/use-post-removal-focus';
import { useFeed, useForYouFeed } from '@/hooks/use-posts';
import { focusComposer } from '@/lib/composer-focus';
import { cn } from '@/lib/utils';
import { Feather, Users } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

const FOLLOWING = 'following';
const FOR_YOU = 'for-you';

// Tabs in display order. `param` is the `?tab=` value (null = no param: the default tab).
const TABS = [
  { id: FOLLOWING, label: 'Following', param: null },
  { id: FOR_YOU, label: 'For you', param: 'for-you' },
];

const PANEL_ID = 'feed-panel';
const tabId = (id) => `feed-tab-${id}`;

const tabClassName = 'relative flex-1 py-3 text-sm font-medium outline-none transition focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50';

// The selected tab lives in the URL: no `tab` param (or an unknown value) = Following,
// `?tab=for-you` = For you. Switching replaces the history entry (tabs aren't pages to go Back
// through) and keeps the other search params, the hash and the router state.
function useFeedTab() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const tab = searchParams.get('tab') === FOR_YOU ? FOR_YOU : FOLLOWING;

  const setTab = (next) => {
    if (next === tab) return;
    const params = new URLSearchParams(location.search);
    const param = TABS.find((t) => t.id === next)?.param;
    if (param) params.set('tab', param);
    else params.delete('tab');
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true, state: location.state },
    );
  };

  return [tab, setTab];
}

// Plain markup with tab semantics rather than Radix Tabs: the selection is URL state and both tabs
// share a single panel (the composer + the selected feed), which Radix's one-panel-per-tab model
// doesn't fit. Roving tabindex with Left/Right (plus Home/End); activation is manual
// (click/Enter/Space), so arrowing across the tabs doesn't fetch a feed on every keypress.
function FeedTabs({ tab, onSelect }) {
  const tabRefs = useRef({});

  const handleKeyDown = (event, index) => {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = tabRefs.current[TABS[nextIndex].id];
    if (!target) return;
    // Move the roving tab stop to the focused tab (reset to the selected one on the next render).
    for (const node of Object.values(tabRefs.current)) {
      if (node) node.tabIndex = node === target ? 0 : -1;
    }
    target.focus();
  };

  return (
    <div role="tablist" aria-label="Feed" className="flex">
      {TABS.map(({ id, label }, index) => {
        const selected = id === tab;
        return (
          <button
            key={id}
            ref={(node) => {
              tabRefs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={tabId(id)}
            aria-selected={selected}
            aria-controls={PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(tabClassName, selected ? 'text-foreground' : 'text-muted-foreground')}
          >
            {label}
            {selected && (
              <span aria-hidden="true" className="absolute bottom-0 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
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

function FollowingEmpty({ onShowForYou }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-16 text-center">
      <Users className="size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-semibold">Your Following feed is empty</h2>
      <p className="text-sm text-balance text-muted-foreground">Follow people to see their posts here.</p>
      <Button variant="outline" onClick={onShowForYou} className="mt-2 rounded-full px-5 font-semibold">
        Explore For you
      </Button>
    </div>
  );
}

function ForYouEmpty() {
  return (
    <div className="grid place-items-center gap-2 px-6 py-16 text-center">
      <Feather className="size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-semibold">No posts yet</h2>
      <p className="text-sm text-balance text-muted-foreground">Nobody has posted yet. Write the first one above.</p>
    </div>
  );
}

// One feed below the composer: loading skeletons, an error with Retry, `empty`, or the posts
// (newest first as served) with infinite scroll and `endMessage` at the end.
function Feed({ feed, empty, errorMessage, endMessage }) {
  const posts = feed.data?.pages.flatMap((page) => page.items);
  const handleDeleted = usePostRemovalFocus(posts);

  if (feed.isPending) return <PostListSkeleton />;

  if (feed.isError && !feed.data) {
    return (
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-6">
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <Button onClick={() => feed.refetch()} disabled={feed.isFetching} className="self-start rounded-full px-5 font-semibold">
          {feed.isFetching && <Spinner aria-hidden="true" />}
          Retry
        </Button>
      </div>
    );
  }

  if (posts.length === 0) return empty;

  return (
    <>
      <h2 className="sr-only">Posts</h2>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} onDeleted={() => handleDeleted(post.id)} />
      ))}
      <InfiniteListFooter
        query={feed}
        endMessage={endMessage}
        errorMessage="Couldn't load more posts. Check your connection and try again."
      />
    </>
  );
}

// Each tab's query lives in its own component, so only the selected feed is fetched.
function FollowingFeed({ onShowForYou }) {
  const feed = useFeed();
  return (
    <Feed
      feed={feed}
      empty={<FollowingEmpty onShowForYou={onShowForYou} />}
      errorMessage="Couldn't load your Following feed. Check your connection and try again."
      endMessage="You're all caught up"
    />
  );
}

function ForYouFeed() {
  const feed = useForYouFeed();
  return (
    <Feed
      feed={feed}
      empty={<ForYouEmpty />}
      errorMessage="Couldn't load the For you feed. Check your connection and try again."
      endMessage="You've seen every post"
    />
  );
}

// The home feed: header with the Following / For you tabs, the composer and the selected feed.
export function Home() {
  useFocusComposerFromNavigation();
  const [tab, setTab] = useFeedTab();

  return (
    <>
      <PageHeader title="Home" trailing={<span className="text-sm text-muted-foreground">created by Alejandro Gomez</span>}>
        <FeedTabs tab={tab} onSelect={setTab} />
      </PageHeader>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(tab)}>
        <div className="border-b border-border">
          <Composer />
        </div>

        {tab === FOR_YOU ? <ForYouFeed /> : <FollowingFeed onShowForYou={() => setTab(FOR_YOU)} />}
      </div>
    </>
  );
}
