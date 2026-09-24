import { cn } from '@/lib/utils'

// The sticky, blurred header every page inside the AppShell's center column renders at its top.
//   title     — the page heading (rendered as the page's `h1`).
//   subtitle  — optional small muted mono line under the title (e.g. "@ada", a post count).
//   leading   — optional element before the title (e.g. a back button).
//   trailing  — optional element at the end of the title row (e.g. an icon or an action).
//   children  — optional content rendered below the title row, full width (e.g. tabs).
//   className — extra classes for the outer header.
export function PageHeader({ title, subtitle, leading, trailing, children, className }) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-md',
        className,
      )}
    >
      <div className={cn('flex items-center gap-4 px-5 sm:px-6', children ? 'pt-4' : 'py-3')}>
        {leading}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="truncate font-mono text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {trailing}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}
