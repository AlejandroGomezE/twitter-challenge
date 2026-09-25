import { Search, UserPlus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { FollowButton } from '@/components/FollowButton'
import { UserAvatar } from '@/components/UserAvatar'
import { UserName } from '@/components/UserName'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useSuggestions } from '@/hooks/use-follows'
import { useProfile } from '@/hooks/use-profile'
import { useUserTypeahead } from '@/hooks/use-user-search'
import { normalizeSearchQuery } from '@/lib/api/search'
import { useAuth } from '@/lib/auth/use-auth'
import { cn } from '@/lib/utils'

const labelClassName = 'font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground'
const cardClassName = 'rounded-2xl border border-border bg-card p-5'

// Right rail (xl only): the user search typeahead, the signed-in user's profile card and a "Who to
// follow" card suggesting up to 3 users to follow.
export function RightRail() {
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-5">
      <SearchBox />

      {user?.username && <ProfileCard username={user.username} authDisplayName={user.displayName} />}

      <WhoToFollowCard />
    </div>
  )
}

const profilePath = (username) => `/u/${encodeURIComponent(username)}`
const explorePath = (query) => `/explore?q=${encodeURIComponent(query)}`
// Same accessible-name convention as the other user links (T4): "Display Name @username", or just
// "@username" without a display name.
const userLabel = ({ username, displayName }) =>
  displayName ? `${displayName} @${username}` : `@${username}`

// The search typeahead: a WAI-ARIA 1.2 combobox (focus stays on the input; the active option is
// conveyed with `aria-activedescendant`) over a listbox of up to 5 matching users plus a final
// "See all results" option that opens Explore. Picking an option navigates, then closes and clears.
//
// Hand-rolled on purpose instead of the shadcn primitives in `components/ui/`: `command.jsx` (cmdk)
// filters and ranks items itself and owns the input, `combobox.jsx` (Base UI) is a value picker
// (choosing an item sets the input's value) with its own filtering, and `popover.jsx` (Radix)
// renders a `role="dialog"` layer that fights the input over focus and outside clicks. Here the
// server does the matching and choosing navigates, so a plain absolutely-positioned panel is the
// simpler fit. The panel stays inside the rail (full rail width, height capped to the viewport with
// its own scroll), so the rail's `overflow-y-auto` never clips it.
function SearchBox() {
  const navigate = useNavigate()
  const listboxId = useId()
  const optionIdPrefix = useId()
  const inputRef = useRef(null)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const { query, searchable } = normalizeSearchQuery(value)
  const { data, isPending, isError, isPlaceholderData } = useUserTypeahead(value)
  const users = data?.items ?? []
  const expanded = open && searchable

  // Options: the users, then "See all results" (always last).
  const optionCount = users.length + 1
  const active = expanded && activeIndex < optionCount ? activeIndex : -1
  const optionId = (index) => `${optionIdPrefix}option-${index}`
  const activeOptionId = active >= 0 ? optionId(active) : undefined

  // Keeps the active option in view when the panel scrolls (short viewports).
  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeOptionId])

  function close() {
    setOpen(false)
    setActiveIndex(-1)
  }

  // After choosing an option: close, clear and let go of focus.
  function reset() {
    close()
    setValue('')
    inputRef.current?.blur()
  }

  function goTo(path) {
    reset()
    navigate(path)
  }

  function handleKeyDown(event) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!searchable) return
        event.preventDefault()
        if (!expanded) {
          setOpen(true)
          return
        }
        const step = event.key === 'ArrowDown' ? 1 : -1
        // Wraps both ways; with no active option, ArrowUp lands on the last one.
        setActiveIndex(
          active === -1 && step === -1 ? optionCount - 1 : (active + step + optionCount) % optionCount,
        )
        return
      }
      case 'Enter':
        if (!searchable) return
        event.preventDefault()
        goTo(active >= 0 && active < users.length ? profilePath(users[active].username) : explorePath(query))
        return
      case 'Escape':
        // Also stops the browser's own "Escape clears a search input": the first Escape only closes.
        event.preventDefault()
        if (expanded) close()
        else setValue('')
        return
      case 'Tab':
        close()
        return
      default:
    }
  }

  // Previous results stay up while the next query loads; the loading row is only for a first result.
  const loading = isPending || (isPlaceholderData && users.length === 0)
  let status = null
  if (isError) status = 'Couldn’t load results.'
  else if (loading && users.length === 0) status = 'Searching…'
  else if (users.length === 0) status = 'No users found'

  const optionClassName = (index) =>
    cn(
      'flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left outline-none',
      index === active && 'bg-accent text-accent-foreground',
    )

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setOpen(true)
          setActiveIndex(-1)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        // Clicking anywhere outside blurs the input, which closes the panel.
        onBlur={close}
        onKeyDown={handleKeyDown}
        className="h-11 rounded-full bg-secondary pl-10"
      />

      {expanded && (
        // mousedown is swallowed so a click inside the panel doesn't blur (and close) the input first.
        <div
          onMouseDown={(event) => event.preventDefault()}
          className="absolute inset-x-0 top-full z-20 mt-2 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-2xl border border-border bg-popover py-2 text-popover-foreground shadow-md"
        >
          <div role="status" data-testid="search-status">
            {status && (
              <p className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground">
                {status === 'Searching…' && <Spinner aria-hidden="true" />}
                {status}
              </p>
            )}
          </div>
          <div id={listboxId} role="listbox" aria-label="Search results">
            {users.map((user, index) => (
              <Link
                key={user.username}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                aria-label={userLabel(user)}
                tabIndex={-1}
                to={profilePath(user.username)}
                onClick={reset}
                onMouseMove={() => index !== active && setActiveIndex(index)}
                className={optionClassName(index)}
              >
                <UserAvatar username={user.username} className="size-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <UserName
                      username={user.username}
                      displayName={user.displayName}
                      fallbackClassName="font-mono font-medium"
                    />
                  </p>
                  {user.bio && (
                    <p className="line-clamp-1 text-xs break-words text-muted-foreground">
                      {user.bio}
                    </p>
                  )}
                </div>
              </Link>
            ))}
            <Link
              id={optionId(users.length)}
              role="option"
              aria-selected={active === users.length}
              tabIndex={-1}
              to={explorePath(query)}
              onClick={reset}
              onMouseMove={() => active !== users.length && setActiveIndex(users.length)}
              className={cn(
                optionClassName(users.length),
                'text-sm font-semibold text-primary',
                users.length > 0 && 'mt-1 border-t border-border',
              )}
            >
              <span className="min-w-0 truncate">See all results for “{query}”</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

// The signed-in user's card.Shares the profile query (and its cache) with the Profile page; while
// it loads a skeleton stands in for the bio, and on an error the bio line is simply left out. The
// display name comes from the profile once loaded, from the signed-in user (`me`) until then.
function ProfileCard({ username, authDisplayName }) {
  const titleId = useId()
  const { data: profile, isPending, isSuccess } = useProfile(username)
  const displayName = isSuccess ? profile.displayName : authDisplayName

  return (
    <section aria-labelledby={titleId} className={cardClassName}>
      <h2 id={titleId} className={labelClassName}>
        Your profile
      </h2>
      <div className="mt-4 flex items-center gap-3">
        <UserAvatar username={username} className="size-12" />
        <p className="min-w-0 flex-1 text-sm">
          <UserName
            username={username}
            displayName={displayName}
            fallbackClassName="font-mono text-muted-foreground"
          />
        </p>
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
  const { username, displayName, bio, isFollowing, followsYou } = suggestion

  return (
    <li className="flex items-center gap-3">
      <Link
        to={`/u/${encodeURIComponent(username)}`}
        aria-label={displayName ? `${displayName} @${username}` : `@${username}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <UserAvatar username={username} className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <UserName
              username={username}
              displayName={displayName}
              fallbackClassName="font-mono font-medium"
            />
          </p>
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
