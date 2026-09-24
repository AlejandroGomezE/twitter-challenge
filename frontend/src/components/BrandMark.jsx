import { Feather } from 'lucide-react'
import { cn } from '@/lib/utils'

// The Flock Twitter logo mark: Pulse's feather in a primary rounded square. Decorative — the
// surrounding link or text carries the brand name.
export function BrandMark({ className, iconClassName }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground',
        className,
      )}
    >
      <Feather className={cn('size-5', iconClassName)} />
    </span>
  )
}
