import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

// Loading placeholder for a list of post-shaped rows (the feed, a profile's posts, comments):
// `count` card skeletons plus an sr-only status named `label`.
export function PostListSkeleton({ label = 'Loading posts', count = 3 }) {
  return (
    <div aria-busy="true">
      <Spinner className="sr-only" aria-label={label} />
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex gap-3.5 border-b border-border px-5 py-4 sm:px-6">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
