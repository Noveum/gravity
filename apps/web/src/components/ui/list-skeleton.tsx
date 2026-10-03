import { Skeleton } from './skeleton.tsx';

export function ListSkeleton({ rows = 12 }: { readonly rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex flex-col"
      data-testid="list-skeleton"
    >
      {Array.from({ length: rows }, (_, index) => `row-${index}`).map((key) => (
        <div key={key} className="flex h-9 items-center gap-3 border-border border-b px-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
