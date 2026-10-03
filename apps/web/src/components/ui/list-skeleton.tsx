import { Skeleton } from './skeleton.tsx';

const SKELETON_GROUPS = [
  { id: 'first', rows: ['a', 'b', 'c', 'd', 'e'], width: 'w-64' },
  { id: 'second', rows: ['a', 'b', 'c', 'd'], width: 'w-80' },
  { id: 'third', rows: ['a', 'b', 'c'], width: 'w-52' },
];

export function ListSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="list-skeleton"
    >
      {SKELETON_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col">
          <div className="flex h-8 items-center gap-2 border-border border-b bg-surface-2/60 px-3">
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          {group.rows.map((row) => (
            <div key={row} className="flex h-7 items-center gap-2 px-3">
              <Skeleton className="size-3.5 rounded-sm" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className={`h-3 ${group.width}`} />
              <Skeleton className="ml-auto size-4.5 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
