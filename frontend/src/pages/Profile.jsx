import { UserAvatar } from '@/components/UserAvatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Link, useParams } from 'react-router';

export function Profile() {
  const { username } = useParams();
  const { user } = useAuth();
  const { data: profile, error, isPending, isError, isFetching, refetch } = useProfile(username);

  if (isPending) {
    return (
      <ProfileShell>
        <div className="flex flex-col items-center gap-4" aria-busy="true">
          <Spinner className="sr-only" />
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
      </ProfileShell>
    );
  }

  if (isError && error instanceof ApiError && error.status === 404) {
    return (
      <ProfileShell>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>User not found</EmptyTitle>
            <EmptyDescription>
              There is no user called @{username}.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/">Back to home</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </ProfileShell>
    );
  }

  if (isError) {
    return (
      <ProfileShell>
        <div className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertDescription>
              Couldn&apos;t load this profile. Check your connection and try again.
            </AlertDescription>
          </Alert>
          <Button onClick={() => refetch()} disabled={isFetching}>
            {isFetching && <Spinner aria-hidden="true" />}
            Retry
          </Button>
        </div>
      </ProfileShell>
    );
  }

  const isOwnProfile =
    Boolean(user?.username) && user.username.toLowerCase() === profile.username.toLowerCase();

  return (
    <ProfileShell>
      <div className="flex flex-col items-center gap-3 text-center">
        <UserAvatar
          username={profile.username}
          size="lg"
          className="size-20"
          fallbackClassName="text-3xl"
        />
        <h1 className="font-heading text-xl font-semibold">@{profile.username}</h1>
        {/* Bio is plain text: rendered as a text node (never HTML), keeping the user's line breaks. */}
        {profile.bio ? (
          <p className="whitespace-pre-wrap break-words">{profile.bio}</p>
        ) : (
          <p className="text-muted-foreground">No bio yet.</p>
        )}
        <p className="text-muted-foreground">
          Joined {format(new Date(profile.createdAt), 'MMMM yyyy')}
        </p>
        {isOwnProfile && (
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/profile">Edit profile</Link>
          </Button>
        )}
      </div>
    </ProfileShell>
  );
}

// Centered card, matching Home's layout.
function ProfileShell({ children }) {
  return (
    <div className="mx-auto max-w-md p-8">
      <Card>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
