import { Search, UserPlus } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router'
import { FollowButton } from '@/components/FollowButton'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSuggestions } from '@/hooks/use-follows'
import { useProfile } from '@/hooks/use-profile'
import { useAuth } from '@/lib/auth/use-auth'
import { ComingSoon } from './ComingSoon'

const labelClassName = 'font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground'
const cardClassName = 'rounded-2xl border border-border bg-card p-5'

// Right rail (xl only): a disabled search box, the signed-in user's profile card and a "Who to
// follow" card suggesting up to 3 users to follow.
export function RightRail() {
  const { user } = useAuth()

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

      <WhoToFollowCard />
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

const SKELETON_ROWS = 3

// "Who to follow": up to 3 users the signed-in user doesn't follow, each linking to their profile
// with a Follow button. Skeleton rows while loading; the whole card is hidden when there's nobody to
// suggest or the request fails (a sidebar nicety, not worth an error box). Following someone flips
// their row to "Following" (optimistic, via useToggleFollow) until the suggestions refetch drops it.
function WhoToFollowCard() {
  const titleId = useId()
  const { data, isPending, isError } = useSuggestions()
  const suggestions = data?.items ?? []

  if (isError || (!isPending && suggestions.length === 0)) return null

  return (
    <section aria-labelledby={titleId} aria-busy={isPending} className={cardClassName}>
      <div className="flex items-center justify-between">
        <h2 id={titleId} className={labelClassName}>
          Who to follow
        </h2>
        <UserPlus className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
      {isPending ? (
        <ul className="mt-4 flex flex-col gap-4" aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li key={index} data-testid="suggestion-skeleton" className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {suggestions.map((suggestion) => (
            <SuggestionRow key={suggestion.username} suggestion={suggestion} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SuggestionRow({ suggestion }) {
  const { username, bio, isFollowing, followsYou } = suggestion

  return (
    <li className="flex items-center gap-3">
      <Link
        to={`/u/${encodeURIComponent(username)}`}
        aria-label={`@${username}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <UserAvatar username={username} className="size-10 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">@{username}</p>
          {bio && <p className="line-clamp-1 text-xs break-words text-muted-foreground">{bio}</p>}
        </div>
      </Link>
      <FollowButton
        username={username}
        isFollowing={isFollowing}
        followsYou={followsYou}
        className="h-9 shrink-0"
      />
    </li>
  )
}
