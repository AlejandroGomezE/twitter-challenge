import { useEffect, type ReactNode } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/utils'

const BRAND_NAME = 'The Flock Twitter'

// Frame for the pages outside the app shell (/sign-in, /sign-up, /sign-out): centered on the page
// background with the brand (mark + name) above the content. `title` sets the document title
// ("<title> · The Flock Twitter") while the page is mounted.
export interface AuthLayoutProps {
  title: string
  className?: string
  children: ReactNode
}

export function AuthLayout({ title, className, children }: AuthLayoutProps) {
  useEffect(() => {
    const previous = document.title
    document.title = `${title} · ${BRAND_NAME}`
    return () => {
      document.title = previous
    }
  }, [title])

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-8">
      <div className="flex items-center gap-2.5 text-foreground">
        <BrandMark className="size-10" iconClassName="size-6" />
        <p className="text-2xl font-semibold tracking-tight">{BRAND_NAME}</p>
      </div>
      <div className={cn('flex w-full max-w-sm flex-col items-center', className)}>{children}</div>
    </div>
  )
}
