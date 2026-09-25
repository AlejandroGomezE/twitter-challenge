import { InfiniteListFooter } from '@/components/feed/InfiniteListFooter';
import { PageHeader } from '@/components/layout/PageHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { UserName } from '@/components/UserName';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useMarkNotificationsRead, useNotifications } from '@/hooks/use-notifications';
import type { Notification, NotificationType } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/use-auth';
import { formatFullDate, formatRelativeShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Bell, Heart, MessageCircle, UserPlus, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

// Per type: the icon, its colour and the action text shown after the actor's name.
const TYPES: Record<NotificationType, { icon: LucideIcon; iconClassName: string; text: string }> = {
  follow: { icon: UserPlus, iconClassName: 'text-primary', text: 'followed you' },
  like: { icon: Heart, iconClassName: 'fill-current text-primary', text: 'liked your post' },
  comment: { icon: MessageCircle, iconClassName: 'text-primary', text: 'commented on your post' },
};

const linkClass =
  'rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50';

// Once the first page has loaded and holds at least one unread item, marks everything up to its
// newest item as read — once per visit (per mount): later pages and refetches never mark again.
// Anything newer than that item (arrived after the page loaded) stays unread. Waits for any fetch
// in flight, so a stale cached first page is judged only after its refetch on mount settles.
function useMarkReadOnFirstPage(query: ReturnType<typeof useNotifications>) {
  const { mutate } = useMarkNotificationsRead();
  const markedRef = useRef(false);
  const firstPage = query.data?.pages[0];
  const settled = !query.isFetching;

  useEffect(() => {
    if (markedRef.current || !firstPage || !settled) return;
    markedRef.current = true;
    const newest = firstPage.items[0];
    if (newest && firstPage.items.some((item) => !item.read)) mutate(newest.createdAt);
  }, [firstPage, settled, mutate]);
}

// The ids seen unread during this visit, so a row stays highlighted even if a later refetch (e.g.
// on window focus, after mark-read) returns it as read. Adjusted during render, not in an effect.
function useUnreadThisVisit(items: Notification[]) {
  const [unreadIds, setUnreadIds] = useState(() => new Set<string>());
  const fresh = items.filter((item) => !item.read && !unreadIds.has(item.id));
  if (fresh.length > 0) {
    const next = new Set(unreadIds);
    for (const item of fresh) next.add(item.id);
    setUnreadIds(next);
  }
  return (item: Notification) => !item.read || unreadIds.has(item.id);
}

// Notifications: who followed you, liked or commented on your posts, newest first with infinite
// scroll. Opening the page marks what it shows as read; rows that were unread stay highlighted
// for the visit.
export function Notifications() {
  return (
    <>
      <PageHeader title="Notifications" />
      <NotificationList />
    </>
  );
}

function NotificationList() {
  const notifications = useNotifications();
  const { user } = useAuth();
  useMarkReadOnFirstPage(notifications);
  const items = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  const wasUnread = useUnreadThisVisit(items);

  if (notifications.isPending) return <NotificationsSkeleton />;

  if (notifications.isError && !notifications.data) {
    return (
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-6">
        <Alert variant="destructive">
          <AlertDescription>
            Couldn't load your notifications. Check your connection and try again.
          </AlertDescription>
        </Alert>
        <Button
          onClick={() => notifications.refetch()}
          disabled={notifications.isFetching}
          className="self-start rounded-full px-5 font-semibold"
        >
          {notifications.isFetching && <Spinner aria-hidden="true" />}
          Retry
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-16 text-center">
        <Bell className="size-6 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-semibold">No notifications yet</h2>
        <p className="text-sm text-balance text-muted-foreground">
          When someone follows you, likes or comments on your posts, you'll see it here.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul aria-label="Notifications">
        {items.map((item) => (
          <li key={item.id}>
            <NotificationRow notification={item} unread={wasUnread(item)} me={user?.username} />
          </li>
        ))}
      </ul>
      <InfiniteListFooter
        query={notifications}
        endMessage="You're all caught up"
        errorMessage="Couldn't load more notifications. Check your connection and try again."
      />
    </>
  );
}

// One notification: the type icon, the actor's avatar, "<actor> <action>" (actor → profile), the
// relative time and, for likes and comments, a snippet (post body / comment body) → the post.
interface NotificationRowProps {
  notification: Notification;
  unread: boolean;
  // The signed-in user's username (the post links live under it).
  me?: string;
}

function NotificationRow({ notification, unread, me }: NotificationRowProps) {
  const { type, actor, post, comment, createdAt } = notification;
  const { icon: Icon, iconClassName, text } = TYPES[type] ?? TYPES.follow;
  const profilePath = `/u/${encodeURIComponent(actor.username)}`;
  const snippet = type === 'comment' ? comment?.body : type === 'like' ? post?.body : null;
  const postPath =
    me && post ? `/u/${encodeURIComponent(me)}/posts/${encodeURIComponent(post.id)}` : null;
  const actorName = actor.displayName || `@${actor.username}`;

  return (
    <article
      aria-label={`${actorName} ${text}`}
      data-unread={unread || undefined}
      className={cn(
        'flex gap-3 border-b border-border px-5 py-4 transition-colors sm:gap-3.5 sm:px-6',
        unread ? 'bg-accent/50 hover:bg-accent/70' : 'hover:bg-muted/40',
      )}
    >
      <div className="flex w-8 shrink-0 justify-end pt-1 sm:w-11">
        <Icon className={cn('size-6', iconClassName)} aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <Link to={profilePath} tabIndex={-1} aria-hidden="true" className="inline-block">
          <UserAvatar username={actor.username} className="size-9" />
        </Link>

        <p className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[15px] leading-relaxed">
          <Link to={profilePath} className={cn('min-w-0 max-w-full truncate', linkClass)}>
            <UserName username={actor.username} displayName={actor.displayName} />
          </Link>
          <span className="text-foreground">{text}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <time
            dateTime={createdAt}
            title={formatFullDate(createdAt)}
            className="font-mono text-sm text-muted-foreground"
          >
            {formatRelativeShort(createdAt)}
          </time>
          {unread && <span className="sr-only">(unread)</span>}
        </p>

        {snippet && postPath && (
          <Link
            to={postPath}
            className={cn(
              'mt-1 block text-[15px] leading-relaxed text-muted-foreground',
              linkClass,
            )}
          >
            <span className="sr-only">
              {type === 'comment' ? 'View comment on your post:' : 'View your post:'}
            </span>{' '}
            <span className="line-clamp-3 break-words whitespace-pre-wrap">{snippet}</span>
          </Link>
        )}
      </div>
    </article>
  );
}

function NotificationsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div aria-busy="true">
      <Spinner className="sr-only" aria-label="Loading notifications" />
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex gap-3 border-b border-border px-5 py-4 sm:gap-3.5 sm:px-6">
          <div className="flex w-8 shrink-0 justify-end pt-1 sm:w-11">
            <Skeleton className="size-6 rounded-full" />
          </div>
          <div className="flex-1">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="mt-3 h-4 w-48" />
            <Skeleton className="mt-2 h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
