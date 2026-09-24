import { Composer } from '@/components/feed/Composer';
import { ComingSoon } from '@/components/layout/ComingSoon';
import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { Feather } from 'lucide-react';

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

// The home feed: header with tabs, the (disabled) composer and, until posts exist, an empty state.
export function Home() {
  return (
    <>
      <PageHeader title="Home" trailing={<span className="text-sm text-muted-foreground">created by Alejandro Gomez</span>}>
        <FeedTabs />
      </PageHeader>

      <div id="feed-panel" role="tabpanel" aria-labelledby="feed-tab-for-you">
        <div className="border-b border-border">
          <Composer />
        </div>

        <div className="grid place-items-center gap-2 px-6 py-16 text-center">
          <Feather className="size-6 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-semibold">No posts yet</h2>
          <p className="text-sm text-balance text-muted-foreground">When posting arrives, the latest posts will show up here.</p>
        </div>
      </div>
    </>
  );
}
