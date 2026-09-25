import { CalendarClock, ImageIcon, MapPin, Smile, type LucideIcon } from 'lucide-react'
import { useId, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { CharacterCounter } from '@/components/feed/CharacterCounter'
import { ComingSoon } from '@/components/layout/ComingSoon'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useCreatePost } from '@/hooks/use-posts'
import { getApiErrorMessage } from '@/lib/api/error-message'
import { useAuth } from '@/lib/auth/use-auth'
import { COMPOSER_TEXTAREA_ID } from '@/lib/composer-focus'
import { isSubmitShortcut, measureBody } from '@/lib/text'

const RATE_LIMIT_MESSAGE = 'Too many posts. Try again in a minute.'

const ATTACHMENTS: { label: string; icon: LucideIcon }[] = [
  { label: 'Add an image', icon: ImageIcon },
  { label: 'Add an emoji', icon: Smile },
  { label: 'Schedule post', icon: CalendarClock },
  { label: 'Add a location', icon: MapPin },
]

// The post composer in Pulse's layout (avatar, auto-growing textarea, attachment icons, counter,
// "Post"). The counter counts the trimmed body in code points, like the backend; Post is disabled
// while the body is blank or over 280. Cmd/Ctrl+Enter submits (not while an IME is composing).
// While the request runs the textarea is read-only (not disabled, so it keeps focus) — the text is
// cleared on success and kept on failure, with the server's error shown below it. The attachment
// icons are "Coming soon" placeholders. The textarea has `id="composer"` so "New post" can focus it
// (see lib/composer-focus.ts). Needs a `TooltipProvider` above it (AppShell provides one).
export function Composer() {
  const { user } = useAuth()
  const username = user?.username
  const counterId = useId()
  const errorId = useId()
  const [body, setBody] = useState('')
  const createPost = useCreatePost()

  const { trimmed, length, remaining, isOver, isValid } = measureBody(body)
  const canSubmit = isValid && !createPost.isPending

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setBody(event.target.value)
    // The error was about the previous text; editing it dismisses the message.
    if (createPost.isError) createPost.reset()
  }

  function submit() {
    if (!canSubmit) return
    createPost.mutate(trimmed, { onSuccess: () => setBody('') })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter, except while an IME is composing (that Enter confirms the composition).
    if (!isSubmitShortcut(event)) return
    event.preventDefault()
    submit()
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3.5 px-5 py-4 sm:px-6">
      {username && <UserAvatar username={username} className="size-11" />}

      <div className="min-w-0 flex-1">
        <Textarea
          id={COMPOSER_TEXTAREA_ID}
          rows={1}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          readOnly={createPost.isPending}
          aria-label="Compose a new post"
          aria-describedby={createPost.isError ? `${counterId} ${errorId}` : counterId}
          aria-invalid={isOver || undefined}
          placeholder="What's happening, quietly?"
          className="min-h-0 resize-none rounded-none border-0 bg-transparent px-0 pt-1.5 text-lg leading-relaxed shadow-none focus-visible:ring-0 aria-invalid:ring-0 md:text-lg dark:bg-transparent"
        />

        {createPost.isError && (
          <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
            {getApiErrorMessage(createPost.error, { rateLimitMessage: RATE_LIMIT_MESSAGE })}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
          <div className="-ml-2 flex items-center text-primary">
            {ATTACHMENTS.map(({ label, icon: Icon }) => (
              <ComingSoon key={label} side="bottom">
                <button type="button" aria-label={label} className="grid place-items-center rounded-full p-2">
                  <Icon className="size-[18px]" aria-hidden="true" />
                </button>
              </ComingSoon>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <CharacterCounter id={counterId} length={length} remaining={remaining} />
            <Button type="submit" disabled={!canSubmit} className="rounded-full px-5 font-semibold">
              {createPost.isPending && <Spinner aria-hidden="true" />}
              Post
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
