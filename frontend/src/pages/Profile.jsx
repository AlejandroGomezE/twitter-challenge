import { InfiniteListFooter } from '@/components/feed/InfiniteListFooter';
import { PostCard } from '@/components/feed/PostCard';
import { PostListSkeleton } from '@/components/feed/PostListSkeleton';
import { FollowButton } from '@/components/FollowButton';
import { FollowListDialog } from '@/components/FollowListDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { usePostRemovalFocus } from '@/hooks/use-post-removal-focus';
import { useUserPosts } from '@/hooks/use-posts';
import { useProfile } from '@/hooks/use-profile';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/use-auth';
import { formatCount } from '@/lib/format';
import { format } from 'date-fns';
import { ArrowLeft, CalendarDays, Feather } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

export function Profile() {
  const { username } = useParams();
  const { user } = useAuth();
  const { data: profile, error, isPending, isError, isFetching, refetch } = useProfile(username, {
    alwaysFresh: true,
  });
  // The follow list open in the FollowListDialog ('following' | 'followers'), or null when closed.
  // Profile stays mounted when only `:username` changes, so the list is closed on that change.
  const [followListTab, setFollowListTab] = useState(null);
  const [followListUsername, setFollowListUsername] = useState(username);
  if (followListUsername !== username) {
    setFollowListUsername(username);
    setFollowListTab(null);
  }

  if (isPending) {
    return (
      <>
        <ProfileHeader title="Profile" />
        <div className="border-b border-border" aria-busy="true">
          <Spinner className="sr-only" />
          <Skeleton className="h-32 rounded-none sm:h-40" />
          <div className="px-5 pb-5 sm:px-6">
            <Skeleton className="-mt-12 size-24 rounded-full border-4 border-background" />
            <Skeleton className="mt-3 h-6 w-32" />
            <Skeleton className="mt-3 h-4 w-48" />
            <Skeleton className="mt-3 h-4 w-28" />
          </div>
        </div>
      </>
    );
  }

  if (isError && error instanceof ApiError && error.status === 404) {
    return (
      <>
        <ProfileHeader title="Profile" />
        <Empty className="px-5 py-16 sm:px-6">
          <EmptyHeader>
            <EmptyTitle>User not found</EmptyTitle>
            <EmptyDescription>
              There is no user called @{username}.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" className="rounded-full font-semibold">
              <Link to="/">Back to home</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  if (isError) {
    return (
      <>
        <ProfileHeader title="Profile" />
        <div className="flex flex-col gap-4 px-5 py-6 sm:px-6">
          <Alert variant="destructive">
            <AlertDescription>
              Couldn&apos;t load this profile. Check your connection and try again.
            </AlertDescription>
          </Alert>
          <Button
            onClick={() => refetch()}
            disabled={isFetching}
            className="self-start rounded-full px-5 font-semibold"
          >
            {isFetching && <Spinner aria-hidden="true" />}
            Retry
          </Button>
        </div>
      </>
    );
  }

  const isOwnProfile =
    Boolean(user?.username) && user.username.toLowerCase() === profile.username.toLowerCase();

  return (
    <>
      <ProfileHeader
        title={<span className="font-mono">@{profile.username}</span>}
        subtitle={postCountLabel(profile.postCount)}
      />

      <div className="border-b border-border">
        <div className="h-32 bg-primary/10 sm:h-40" />
        <div className="px-5 pb-5 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <UserAvatar
              username={profile.username}
              className="-mt-12 size-24 border-4 border-background"
              fallbackClassName="text-3xl"
            />
            {isOwnProfile && (
              <Button
                asChild
                variant="outline"
                className="mt-3 rounded-full border-foreground/20 font-semibold"
              >
                <Link to="/settings/profile">Edit profile</Link>
              </Button>
            )}
            {!isOwnProfile && (
              <FollowButton
                username={profile.username}
                isFollowing={Boolean(profile.isFollowing)}
                followsYou={Boolean(profile.followsYou)}
                className="mt-3"
              />
            )}
          </div>
          {/* Name line: Pulse shows a display name here; we only have the username. Not a heading,
              so it doesn't repeat the page's h1 for screen readers. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-mono text-xl font-semibold break-words">@{profile.username}</p>
            {!isOwnProfile && profile.followsYou && (
              <Badge variant="secondary" className="rounded-md text-muted-foreground">
                Follows you
              </Badge>
            )}
          </div>
          {/* Bio is plain text: rendered as a text node (never HTML), keeping the user's line breaks. */}
          {profile.bio ? (
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
              {profile.bio}
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No bio yet.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-4" aria-hidden="true" />
              Joined {format(new Date(profile.createdAt), 'MMMM yyyy')}
            </span>
          </div>
          <FollowCounts
            profile={profile}
            openTab={followListTab}
            onOpenFollowList={setFollowListTab}
          />
        </div>
      </div>

      <FollowListDialog
        username={profile.username}
        tab={followListTab}
        onTabChange={setFollowListTab}
        onClose={() => setFollowListTab(null)}
        isOwnProfile={isOwnProfile}
      />

      <ProfileTabs />

      <div id="profile-posts-panel" role="tabpanel" aria-labelledby="profile-tab-posts">
        <ProfilePosts username={profile.username} isOwnProfile={isOwnProfile} />
      </div>
    </>
  );
}

// "242 Following  18 Followers" below the join date; each item opens that follow list
// (`onOpenFollowList('following' | 'followers')`); `openTab` is the list currently open (its
// button is marked expanded). Hidden while the counts aren't known.
function FollowCounts({ profile, openTab, onOpenFollowList }) {
  const { followingCount, followerCount } = profile;
  if (typeof followingCount !== 'number' || typeof followerCount !== 'number') return null;

  const items = [
    { tab: 'following', count: followingCount, label: 'Following' },
    { tab: 'followers', count: followerCount, label: followerCount === 1 ? 'Follower' : 'Followers' },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {items.map(({ tab, count, label }) => (
        <button
          key={tab}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={openTab === tab}
          onClick={() => onOpenFollowList(tab)}
          className="rounded-sm text-muted-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="font-semibold text-foreground">{formatCount(count)}</span> {label}
        </button>
      ))}
    </div>
  );
}

// "1 post" / "12 posts" / "1.2K posts"; nothing while the count isn't known.
function postCountLabel(postCount) {
  if (typeof postCount !== 'number') return undefined;
  return `${formatCount(postCount)} ${postCount === 1 ? 'post' : 'posts'}`;
}

// The Posts tab's content: that user's posts, newest first, with infinite scroll + "Load more",
// loading skeletons, an error with Retry, and an empty state worded for your own profile or
// someone else's.
function ProfilePosts({ username, isOwnProfile }) {
  const posts = useUserPosts(username);
  const items = posts.data?.pages.flatMap((page) => page.items);
  const handleDeleted = usePostRemovalFocus(items);

  if (posts.isPending) return <PostListSkeleton />;

  if (posts.isError && !posts.data) {
    return (
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-6">
        <Alert variant="destructive">
          <AlertDescription>
            Couldn&apos;t load posts. Check your connection and try again.
          </AlertDescription>
        </Alert>
        <Button
          onClick={() => posts.refetch()}
          disabled={posts.isFetching}
          className="self-start rounded-full px-5 font-semibold"
        >
          {posts.isFetching && <Spinner aria-hidden="true" />}
          Retry
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-16 text-center">
        <Feather className="size-6 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-semibold">
          {isOwnProfile ? "You haven't posted yet" : `@${username} hasn't posted yet`}
        </h2>
        <p className="text-sm text-balance text-muted-foreground">
          {isOwnProfile
            ? 'Your posts will show up here.'
            : `When @${username} posts, it will show up here.`}
        </p>
      </div>
    );
  }

  return (
    <>
      <h2 className="sr-only">Posts</h2>
      {items.map((post) => (
        <PostCard key={post.id} post={post} onDeleted={() => handleDeleted(post.id)} />
      ))}
      <InfiniteListFooter
        query={posts}
        endMessage={`That's all of @${username}'s posts`}
        errorMessage="Couldn't load more posts. Check your connection and try again."
      />
    </>
  );
}

// Sticky header with a back button to Home; `title` becomes the page's h1.
function ProfileHeader({ title, subtitle }) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      leading={
        <Button asChild variant="ghost" size="icon-lg" className="rounded-full">
          <Link to="/" aria-label="Back to home">
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
        </Button>
      }
    />
  );
}

// Only "Posts" exists, so this is plain markup with tab semantics (no switching), like Home's tabs.
function ProfileTabs() {
  return (
    <div role="tablist" aria-label="Profile" className="flex border-b border-border px-5 sm:px-6">
      <button
        type="button"
        role="tab"
        id="profile-tab-posts"
        aria-selected="true"
        aria-controls="profile-posts-panel"
        className="border-b-4 border-primary py-3 text-sm font-semibold outline-none transition focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        Posts
      </button>
    </div>
  );
}
