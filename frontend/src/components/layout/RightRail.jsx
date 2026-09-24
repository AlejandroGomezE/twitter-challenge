import { Search, UserPlus } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useProfile } from '@/hooks/use-profile'
import { useAuth } from '@/lib/auth/use-auth'
import { ComingSoon } from './ComingSoon'

const labelClassName = 'font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground'
const cardClassName = 'rounded-2xl border border-border bg-card p-5'

// Right rail (xl only): a disabled search box, the signed-in user's profile card and a disabled
// "Who to follow" card (no suggested users until follows exist).
export function RightRail() {
  const { user } = useAuth()
  const whoToFollowId = useId()

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <ComingSoon side="bottom">
          <Input
            type="search"
            readOnly
            aria-label="Search"
            placeholder="Search"
            className="h-11 rounded-full bg-secondary pl-10"
          />
        </ComingSoon>
      </div>

      {user?.username && <ProfileCard username={user.username} />}

      <section aria-labelledby={whoToFollowId} className={cardClassName}>
        <div className="flex items-center justify-between">
          <h2 id={whoToFollowId} className={labelClassName}>
            Who to follow
          </h2>
          <UserPlus className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Coming soon</p>
      </section>
    </div>
  )
}

// The signed-in user's card. Shares the profile query (and its cache) with the Profile page; while
// it loads a skeleton stands in for the bio, and on an error the bio line is simply left out.
function ProfileCard({ username }) {
  const titleId = useId()
  const { data: profile, isPending, isSuccess } = useProfile(username)

  return (
    <section aria-labelledby={titleId} className={cardClassName}>
      <h2 id={titleId} className={labelClassName}>
        Your profile
      </h2>
      <div className="mt-4 flex items-center gap-3">
        <UserAvatar username={username} className="size-12" />
        <p className="min-w-0 truncate font-mono text-sm text-muted-foreground">@{username}</p>
      </div>
      {isPending && <Skeleton className="mt-4 h-4 w-3/4" />}
      {isSuccess &&
        (profile.bio ? (
          <p className="mt-4 line-clamp-4 text-sm break-words whitespace-pre-wrap">{profile.bio}</p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No bio yet.</p>
        ))}
      <Button asChild variant="outline" className="mt-5 h-10 w-full rounded-full font-semibold">
        <Link to={`/u/${encodeURIComponent(username)}`}>View profile</Link>
      </Button>
    </section>
  )
}
