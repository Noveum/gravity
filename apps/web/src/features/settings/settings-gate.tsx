'use client';

import type { ReactNode } from 'react';
import { ErrorState } from '@/components/ui/error-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e', 'f'];

function SettingsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-72" />
      </div>
      <div className="flex flex-col">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="flex h-7 items-center gap-2 px-2">
            <Skeleton className="size-3.5 rounded-sm" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsGate({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const bootstrap = useBootstrap();
  const loading = useDelayedFlag(bootstrap.isPending);
  if (bootstrap.data !== undefined) return children;
  if (bootstrap.error !== null) {
    return (
      <ErrorState
        title={title}
        error={bootstrap.error}
        onRetry={() => {
          bootstrap.refetch().catch(() => undefined);
        }}
      />
    );
  }
  return loading ? <SettingsSkeleton /> : null;
}
