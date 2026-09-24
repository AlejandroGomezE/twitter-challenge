import { PageHeader } from '@/components/layout/PageHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { useProfile } from '@/hooks/use-profile';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/use-auth';
import { format } from 'date-fns';
import { ArrowLeft, CalendarDays, Feather } from 'lucide-react';
import { Link, useParams } from 'react-router';

export function Profile() {
  const { username } = useParams();
  const { user } = useAuth();
  const { data: profile, error, isPending, isError, isFetching, refetch } = useProfile(username);

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
      <ProfileHeader title={<span className="font-mono">@{profile.username}</span>} />

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
          </div>
          {/* Name line: Pulse shows a display name here; we only have the username. Not a heading,
              so it doesn't repeat the page's h1 for screen readers. */}
          <p className="mt-3 font-mono text-xl font-semibold break-words">@{profile.username}</p>
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
        </div>
      </div>

      <ProfileTabs />

      <div
        id="profile-posts-panel"
        role="tabpanel"
        aria-labelledby="profile-tab-posts"
        className="grid place-items-center gap-2 px-6 py-16 text-center"
      >
        <Feather className="size-6 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-semibold">No posts yet</h2>
        <p className="text-sm text-balance text-muted-foreground">
          When posting arrives, @{profile.username}&apos;s posts will show up here.
        </p>
      </div>
    </>
  );
}

// Sticky header with a back button to Home; `title` becomes the page's h1.
function ProfileHeader({ title }) {
  return (
    <PageHeader
      title={title}
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
