import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const preventActivation = (event) => event.preventDefault()

// The shared "Coming soon" pattern for features we show but don't have yet. Wraps a single
// focusable, non-link element (a `<button type="button">`, a read-only input) and, through the
// tooltip trigger's Slot, marks it `aria-disabled`, muted and inert on click/Enter/Space, with a
// "Coming soon" tooltip on hover and keyboard focus. The element is deliberately NOT `disabled`:
// disabled elements get no focus or pointer events, so the tooltip would be unreachable.
// Needs a `TooltipProvider` above it (AppShell provides one).
export function ComingSoon({ children, side = 'right' }) {
  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        aria-disabled="true"
        onClick={preventActivation}
        className="cursor-not-allowed opacity-50"
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        Coming soon
      </TooltipContent>
    </Tooltip>
  )
}
