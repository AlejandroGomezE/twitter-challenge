import { POST_MAX_LENGTH, limitAnnouncement } from '@/lib/text';
import { cn } from '@/lib/utils';

// The `N/280` counter shared by the post and comment composers: a mono `length/280` (destructive
// when over the limit) whose `id` the textarea points at with `aria-describedby`, plus a polite
// sr-only live region that only speaks near / over the limit (see `limitAnnouncement`).
export function CharacterCounter({ id, length, remaining }) {
  const isOver = remaining < 0;

  return (
    <>
      <span
        id={id}
        className={cn(
          'font-mono text-sm tabular-nums',
          isOver ? 'font-semibold text-destructive' : 'text-muted-foreground',
        )}
      >
        {length}/{POST_MAX_LENGTH}
      </span>
      <span aria-live="polite" className="sr-only">
        {limitAnnouncement(remaining)}
      </span>
    </>
  );
}
