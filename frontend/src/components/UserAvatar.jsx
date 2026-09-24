import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatar-color';
import { cn } from '@/lib/utils';

// Avatar placeholder (no image upload yet): the username's initial on a colour derived from the
// username. The root carries the accessible name (`@username`); the letter itself is decorative.
// `size` is the shadcn Avatar size variant (`sm` | `default` | `lg`); `className` can enlarge it.
export function UserAvatar({ username, size = 'default', className, fallbackClassName }) {
  return (
    <Avatar size={size} role="img" aria-label={`@${username}`} className={className}>
      <AvatarFallback
        aria-hidden="true"
        className={cn('font-medium', getAvatarColor(username), fallbackClassName)}
      >
        {getAvatarInitial(username)}
      </AvatarFallback>
    </Avatar>
  );
}
