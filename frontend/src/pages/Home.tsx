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
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { focusComposer } from '@/lib/composer-focus';
import { useNewPosts, useShowNewPosts } from '@/lib/realtime/use-new-posts';
import { cn } from '@/lib/utils';
import { ArrowUp, Feather, Users } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

const FOLLOWING = 'following';
const FOR_YOU = 'for-you';

type FeedTab = typeof FOLLOWING | typeof FOR_YOU;

// Tabs in display order. `param` is the `?tab=` value (null = no param: the default tab).
const TABS: { id: FeedTab; label: string; param: string | null }[] = [
  { id: FOLLOWING, label: 'Following', param: null },
  { id: FOR_YOU, label: 'For you', param: 'for-you' },
];

const PANEL_ID = 'feed-panel';
const tabId = (id: FeedTab) => `feed-tab-${id}`;

const tabClassName = 'relative flex-1 py-3 text-sm font-medium outline-none transition focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50';

// The selected tab lives in the URL: no `tab` param (or an unknown value) = Following,
// `?tab=for-you` = For you. Switching replaces the history entry (tabs aren't pages to go Back
// through) and keeps the other search params, the hash and the router state.
function useFeedTab(): [FeedTab, (next: FeedTab) => void] {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const tab = searchParams.get('tab') === FOR_YOU ? FOR_YOU : FOLLOWING;

  const setTab = (next: FeedTab) => {
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
interface FeedTabsProps {
  tab: FeedTab;
  onSelect: (tab: FeedTab) => void;
}

function FeedTabs({ tab, onSelect }: FeedTabsProps) {
  const tabRefs = useRef<Partial<Record<FeedTab, HTMLButtonElement | null>>>({});

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
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

// "1 new post" / "N new posts", capped at "99+".
const newPostsLabel = (count: number) => `${count > 99 ? '99+' : count} new ${count === 1 ? 'post' : 'posts'}`;

// How long the pending count must hold still before the live region reads it out, so a burst of
// posts is announced once, with its final count.
const ANNOUNCE_DELAY_MS = 1000;

// The "N new posts" pill for the selected tab, plus a polite live region announcing its count.
// New posts are never inserted on their own: they wait here until the pill is clicked, which
// reloads that feed from the first page, scrolls to the top and moves focus to the top of the feed
// panel.
//
// Layout — two siblings, direct children of the feed panel, between the composer and the feed:
// - The row: a grid whose single track animates `grid-template-rows` 0fr -> 1fr (its content,
//   clipped by an `overflow-hidden` cell, is a fixed h-14), so it opens to its natural height when
//   the first post arrives and closes when the pill clears. This is the only layout change: later
//   posts only change the label, so the list moves once on open and once on close.
// - The pill: a zero-height `position: sticky` overlay placed just before the row, whose button
//   hangs down into the row's space (mt-2.5 + h-9 = centred in 56px). It is NOT inside the row: a
//   sticky box can only travel within its parent (the row is 56px tall), and an `overflow-hidden`
//   ancestor would become its scroll container and stop it sticking to the page. As a sibling its
//   containing block is the whole feed panel (no clipping ancestors up to the page), so it sits in
//   the row at the top of the page and, once scrolled, docks under the sticky PageHeader.
//   `top-[101px]` is that header's height, the same at every width: border-b 1px + title row pt-4
//   16px + text-xl h1 28px + tabs mt-3 12px + tab py-3/text-sm 44px (nothing wraps).
// While closing, the pill stays mounted with its last count so it can fade out, but it is inert,
// aria-hidden, untabbable and ignores the pointer. `prefers-reduced-motion` drops the transitions.
// The fade/slide transform lives on a wrapper, so it never fights the Button's own
// `active:translate-y-px`.
interface NewPostsPillProps {
  tab: FeedTab;
  onShown: () => void;
}

function NewPostsPill({ tab, onShown }: NewPostsPillProps) {
  const { count } = useNewPosts(tab);
  const show = useShowNewPosts(tab);
  const announcedCount = useDebouncedValue(count, ANNOUNCE_DELAY_MS);
  const open = count > 0;

  // The last non-zero count, kept for the fade-out (updated during render, not in an effect).
  const [shownCount, setShownCount] = useState(count);
  if (open && count !== shownCount) setShownCount(count);
  const label = newPostsLabel(open ? count : shownCount);

  const handleClick = () => {
    onShown();
    show();
  };

  return (
    <>
      <div role="status" className="sr-only">
        {announcedCount > 0 ? `${newPostsLabel(announcedCount)} available` : ''}
      </div>
      <div className="pointer-events-none sticky top-[101px] z-10 flex h-0 items-start justify-center overflow-visible px-4">
        <div
          data-testid="new-posts-pill"
          inert={!open}
          aria-hidden={open ? undefined : true}
          className={cn(
            'mt-2.5 transition duration-200 ease-out motion-reduce:transition-none',
            open ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0',
          )}
        >
          <Button
            onClick={handleClick}
            aria-label={`Show ${label}`}
            tabIndex={open ? undefined : -1}
            className={cn(
              'h-9 rounded-full px-4 font-semibold shadow-lg shadow-primary/20',
              open ? 'pointer-events-auto' : 'pointer-events-none',
            )}
          >
            <ArrowUp aria-hidden="true" />
            {label}
          </Button>
        </div>
      </div>
      <div
        data-testid="new-posts-row"
        aria-hidden="true"
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="h-14 border-b border-border" />
        </div>
      </div>
    </>
  );
}

function FollowingEmpty({ onShowForYou }: { onShowForYou: () => void }) {
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
interface FeedProps {
  feed: ReturnType<typeof useFeed>;
  empty: ReactNode;
  errorMessage: string;
  endMessage: string;
}

function Feed({ feed, empty, errorMessage, endMessage }: FeedProps) {
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

  // `posts` is always set by now (the pending and error-without-data cases returned above).
  if (!posts || posts.length === 0) return empty;

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
function FollowingFeed({ onShowForYou }: { onShowForYou: () => void }) {
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
  const panelRef = useRef<HTMLDivElement>(null);

  // After the pill: back to the top, with focus on the feed panel (the pill unmounts), so the next
  // Tab / reading step reaches the composer and then the new posts.
  const handleNewPostsShown = () => {
    window.scrollTo({ top: 0 });
    panelRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <PageHeader title="Home" trailing={<span className="text-sm text-muted-foreground">created by Alejandro Gomez</span>}>
        <FeedTabs tab={tab} onSelect={setTab} />
      </PageHeader>

      <div ref={panelRef} id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(tab)} tabIndex={-1} className="outline-none">
        <div className="border-b border-border">
          <Composer />
        </div>

        <NewPostsPill key={tab} tab={tab} onShown={handleNewPostsShown} />

        {tab === FOR_YOU ? <ForYouFeed /> : <FollowingFeed onShowForYou={() => setTab(FOR_YOU)} />}
      </div>
    </>
  );
}
