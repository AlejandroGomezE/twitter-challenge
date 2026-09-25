import { InfiniteListFooter } from '@/components/feed/InfiniteListFooter';
import { FollowButton } from '@/components/FollowButton';
import { UserAvatar } from '@/components/UserAvatar';
import { UserName } from '@/components/UserName';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFollowers, useFollowing } from '@/hooks/use-follows';
import { useAuth } from '@/lib/auth/use-auth';
import { Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';

const TABS = [
  { value: 'following', label: 'Following' },
  { value: 'followers', label: 'Followers' },
];

// The profile's follow lists in a modal: `@username` as the title and Following / Followers tabs.
// Controlled by the caller: `tab` is the open tab ('following' | 'followers') or null when closed;
// `onTabChange(tab)` switches tabs, `onClose()` closes it (Esc, the close button, the overlay, or
// following a row's profile link — the caller's page may stay mounted across `/u/:username`, so the
// dialog must close itself on navigation). Only the visible tab's list is fetched, and it is
// refetched every time it becomes visible (opened on it / switched to it; cached rows stay shown
// meanwhile) — but not on a row's follow toggle, so an unfollowed row stays put; each list pages
// in with `InfiniteListFooter` inside the dialog's scrollable body. `isOwnProfile` words the empty
// states for the signed-in user's own lists.
export function FollowListDialog({ username, tab, onTabChange, onClose, isOwnProfile = false }) {
  const open = tab !== null;
  // Keep showing the last tab while the dialog animates closed (`tab` is already null then).
  const [shownTab, setShownTab] = useState(tab ?? 'following');
  if (tab !== null && tab !== shownTab) setShownTab(tab);

  const following = useFollowing(username, {
    enabled: open && shownTab === 'following',
    alwaysFresh: true,
  });
  const followers = useFollowers(username, {
    enabled: open && shownTab === 'followers',
    alwaysFresh: true,
  });
  const queries = { following, followers };

  // Radix only returns focus to a `DialogTrigger` on close; this dialog is opened from outside (the
  // profile's count buttons), so remember what had focus when it opened and restore it on close.
  const returnFocusRef = useRef(null);
  function handleOpenAutoFocus() {
    returnFocusRef.current = document.activeElement;
  }
  function handleCloseAutoFocus(event) {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target instanceof HTMLElement && target.isConnected) {
      event.preventDefault();
      target.focus();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        className="flex max-h-[min(40rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="truncate pr-8 font-mono text-base font-semibold">
            @{username}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isOwnProfile
              ? 'People you follow and people who follow you'
              : `People @${username} follows and people who follow @${username}`}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={shownTab}
          onValueChange={onTabChange}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList
            variant="line"
            aria-label={`@${username}'s follow lists`}
            className="w-full shrink-0 border-b border-border px-4"
          >
            {TABS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value} className="font-semibold">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map(({ value }) => (
            <TabsContent key={value} value={value} className="min-h-0 flex-1 overflow-y-auto">
              <FollowList
                kind={value}
                query={queries[value]}
                username={username}
                isOwnProfile={isOwnProfile}
                onNavigate={onClose}
              />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// One tab's list: skeleton rows while loading, an error with Retry, an empty state, or the rows
// followed by the infinite-scroll footer.
function FollowList({ kind, query, username, isOwnProfile, onNavigate }) {
  const { user } = useAuth();
  const me = user?.username?.toLowerCase() ?? null;

  if (query.isPending) return <FollowListSkeleton />;

  if (query.isError && !query.data) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6">
        <Alert variant="destructive">
          <AlertDescription>
            {kind === 'following'
              ? "Couldn't load who this user follows. Check your connection and try again."
              : "Couldn't load this user's followers. Check your connection and try again."}
          </AlertDescription>
        </Alert>
        <Button
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="self-start rounded-full px-5 font-semibold"
        >
          {query.isFetching && <Spinner aria-hidden="true" />}
          Retry
        </Button>
      </div>
    );
  }

  const items = query.data.pages.flatMap((page) => page.items);

  if (items.length === 0) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-12 text-center">
        <Users className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="font-semibold">{emptyMessage(kind, username, isOwnProfile)}</p>
      </div>
    );
  }

  return (
    <>
      <ul aria-label={kind === 'following' ? 'Following' : 'Followers'}>
        {items.map((item) => (
          <FollowListRow
            key={item.username}
            item={item}
            isMe={me !== null && item.username.toLowerCase() === me}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      <InfiniteListFooter
        query={query}
        errorMessage="Couldn't load more users. Check your connection and try again."
      />
    </>
  );
}

function emptyMessage(kind, username, isOwnProfile) {
  if (kind === 'following') {
    return isOwnProfile
      ? "You aren't following anyone yet"
      : `@${username} isn't following anyone yet`;
  }
  return isOwnProfile
    ? "You don't have any followers yet"
    : `@${username} doesn't have any followers yet`;
}

// A user row. The whole row is clickable through the username link, stretched over the row with
// an `::after` overlay (a button can't live inside an `<a>`); the follow button sits above it.
function FollowListRow({ item, isMe, onNavigate }) {
  return (
    <li className="relative flex items-start gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50">
      <UserAvatar username={item.username} size="lg" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <Link
          to={`/u/${encodeURIComponent(item.username)}`}
          onClick={onNavigate}
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

function FollowListSkeleton({ count = 4 }) {
  return (
    <div aria-busy="true">
      <Spinner className="sr-only" aria-label="Loading users" />
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-border px-4 py-3">
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
