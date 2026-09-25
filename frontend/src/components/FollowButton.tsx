import { Button } from '@/components/ui/button';
import { useToggleFollow } from '@/hooks/use-follows';
import { cn } from '@/lib/utils';
import { useState, type MouseEvent } from 'react';

// Twitter-style follow toggle for `username`:
// - not following → "Follow" (or "Follow back" when they follow you), a filled pill;
// - following → "Following", an outline pill that reads "Unfollow" (destructive styling) while
//   hovered or focused; one click unfollows (no confirm dialog).
// The toggle goes through `useToggleFollow()`, which owns the optimistic cache updates, rollback and
// rapid-click handling, so the button stays clickable while a request is in flight. Clicks don't
// bubble to (or trigger) a surrounding link/row, so it can sit inside rows that link to profiles.
export interface FollowButtonProps {
  username: string;
  isFollowing: boolean;
  followsYou?: boolean;
  className?: string;
}

export function FollowButton({
  username,
  isFollowing,
  followsYou = false,
  className,
}: FollowButtonProps) {
  const toggleFollow = useToggleFollow();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const showUnfollow = isFollowing && (hovered || focused);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    toggleFollow.mutate({ username, following: !isFollowing });
  }

  let label = 'Follow';
  if (isFollowing) label = showUnfollow ? 'Unfollow' : 'Following';
  else if (followsYou) label = 'Follow back';

  return (
    <Button
      type="button"
      variant={isFollowing ? 'outline' : 'default'}
      aria-label={isFollowing ? `Unfollow @${username}` : `${label} @${username}`}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        'min-w-24 rounded-full px-4 font-semibold',
        isFollowing && 'border-foreground/20',
        showUnfollow &&
          'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive dark:bg-destructive/20 dark:hover:bg-destructive/20',
        className,
      )}
    >
      {label}
    </Button>
  );
}
