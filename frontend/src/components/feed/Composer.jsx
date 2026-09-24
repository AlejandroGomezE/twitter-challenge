import { CalendarClock, ImageIcon, MapPin, Smile } from 'lucide-react'
import { useId } from 'react'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth/use-auth'

const MAX_LENGTH = 280

const ATTACHMENTS = [
  { label: 'Add an image', icon: ImageIcon },
  { label: 'Add an emoji', icon: Smile },
  { label: 'Schedule post', icon: CalendarClock },
  { label: 'Add a location', icon: MapPin },
]

// The post composer in Pulse's layout (avatar, auto-growing textarea, attachment icons, counter,
// "Post"). Visual only until posts exist: everything is disabled and a visible hint says why.
export function Composer() {
  const { user } = useAuth()
  const username = user?.username
  const hintId = useId()

  return (
    <div className="flex gap-3.5 px-5 py-4 sm:px-6">
      {username && <UserAvatar username={username} className="size-11" />}

      <div className="min-w-0 flex-1">
        <Textarea
          rows={1}
          disabled
          aria-disabled="true"
          aria-label="Compose a new post"
          aria-describedby={hintId}
          maxLength={MAX_LENGTH}
          placeholder="What's happening, quietly?"
          className="min-h-0 resize-none rounded-none border-0 bg-transparent px-0 pt-1.5 text-lg leading-relaxed shadow-none focus-visible:ring-0 disabled:bg-transparent md:text-lg dark:bg-transparent dark:disabled:bg-transparent"
        />

        <p id={hintId} className="mt-1 font-mono text-xs text-muted-foreground">
          Posting is coming soon
        </p>

        <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
          <div className="-ml-2 flex items-center text-primary">
            {ATTACHMENTS.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                disabled
                aria-label={label}
                className="grid place-items-center rounded-full p-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="size-[18px]" aria-hidden="true" />
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground tabular-nums">
              0/{MAX_LENGTH}
            </span>
            <Button type="button" disabled className="rounded-full px-5 font-semibold">
              Post
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
