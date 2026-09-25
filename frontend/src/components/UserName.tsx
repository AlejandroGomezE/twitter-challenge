import { cn } from '@/lib/utils';

// A user's name line: the display name (bold, foreground) followed by the muted `@username`. When
// the user has no display name (`null`/empty) only `@username` shows, styled by
// `fallbackClassName` so each caller keeps its existing look.
//
// Always one line: when space runs out the display name truncates first; the `@username` keeps its
// natural width (it only truncates beyond 60% of the line), so it never disappears entirely.
// `stacked` puts `@username` on its own line under the name (the profile header), each line
// truncating on its own. `className` sets the size on the root; `nameClassName` /
// `usernameClassName` tune the two parts when a display name is shown. Renders plain `<span>`s
// (put it inside a link, a `<p>`, …); the accessible text is "Display Name @username".
export interface UserNameProps {
  username: string;
  displayName?: string | null;
  stacked?: boolean;
  className?: string;
  nameClassName?: string;
  usernameClassName?: string;
  fallbackClassName?: string;
}

export function UserName({
  username,
  displayName,
  stacked = false,
  className,
  nameClassName,
  usernameClassName,
  fallbackClassName = 'font-mono font-semibold text-foreground',
}: UserNameProps) {
  const handle = `@${username}`;

  if (!displayName) {
    return <span className={cn('block min-w-0 truncate', fallbackClassName, className)}>{handle}</span>;
  }

  return (
    <span
      data-slot="user-name"
      className={cn(
        'flex min-w-0',
        stacked ? 'flex-col' : 'items-baseline gap-x-1.5',
        className,
      )}
    >
      <span className={cn('min-w-0 truncate font-semibold text-foreground', nameClassName)}>
        {displayName}
      </span>
      {/* So the text reads "Name @username"; whitespace between flex items isn't rendered. */}
      {' '}
      <span
        className={cn(
          'min-w-0 truncate font-mono font-normal text-muted-foreground',
          !stacked && 'max-w-[60%] shrink-0',
          usernameClassName,
        )}
      >
        {handle}
      </span>
    </span>
  );
}
