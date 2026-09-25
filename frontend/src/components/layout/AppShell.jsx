import { Feather } from 'lucide-react'
import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useOpenComposer } from '@/hooks/use-open-composer'
import { MobileNav } from './MobileNav'
import { RightRail } from './RightRail'
import { SideNav } from './SideNav'

// Layout route for every gated page: left rail (lg+), the page in the center column, right rail
// (xl+), and below lg a bottom nav plus the compose button (→ Home, focusing the composer). Pages render their own sticky header.
export function AppShell() {
  const openComposer = useOpenComposer()

  return (
    <TooltipProvider>
      <a
        href="#main-content"
        className="sr-only rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
      >
        Skip to content
      </a>
      <div className="mx-auto flex w-full max-w-[1290px] gap-8">
        <header className="sticky top-0 hidden h-dvh shrink-0 lg:block lg:w-[88px] xl:w-[275px]">
          <SideNav />
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-h-dvh w-full min-w-0 flex-1 flex-col border-x border-border outline-none lg:max-w-[620px]"
        >
          <div className="flex-1">
            <Outlet />
          </div>
          <MobileNav />
        </main>

        {/* `overflow-y-auto` also clips horizontally, so the rail gets inline padding (width grown
            to match, content stays 350px) for the search box's 3px focus ring and the typeahead
            panel's shadow to show in full. */}
        <aside
          aria-label="Sidebar"
          className="sticky top-0 hidden h-dvh w-[366px] shrink-0 overflow-y-auto px-2 py-8 xl:block"
        >
          <RightRail />
        </aside>

        <Button
          type="button"
          aria-label="New post"
          onClick={openComposer}
          className="fixed right-5 bottom-20 z-30 size-14 rounded-full shadow-lg lg:hidden"
        >
          <Feather className="size-6" aria-hidden="true" />
        </Button>
      </div>
    </TooltipProvider>
  )
}
