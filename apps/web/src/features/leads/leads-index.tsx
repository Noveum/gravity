'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ErrorState } from '@/components/ui/error-state.tsx';
import { ListSkeleton } from '@/components/ui/list-skeleton.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { lastPipelineKey } from '@/lib/last-pipeline.ts';
import { leadsHref } from '@/lib/navigation.ts';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';

export function LeadsIndex() {
  const router = useRouter();
  const workspace = useWorkspace();
  const bootstrap = useBootstrap();
  const target = useMemo(() => {
    if (!workspace.ready) return null;
    const remembered = lastPipelineKey(workspace.userId);
    const pipeline =
      (remembered === null ? undefined : workspace.pipelineByKey.get(remembered)) ??
      workspace.pipelines[0];
    return pipeline?.key ?? null;
  }, [workspace]);
  useEffect(() => {
    if (target !== null) router.replace(leadsHref(target));
  }, [router, target]);
  const loading = useDelayedFlag(bootstrap.isPending);

  if (bootstrap.error !== null) {
    return (
      <ErrorState
        title="Could not load your pipelines"
        error={bootstrap.error}
        onRetry={() => {
          bootstrap.refetch().catch(() => undefined);
        }}
      />
    );
  }
  if (workspace.ready && target === null) {
    return (
      <EmptyState
        title="No pipelines yet"
        description="Create a brand in Settings and it comes with a prospecting pipeline."
        action={
          <Link href="/settings/brands" className="font-medium text-accent text-dense">
            Create a brand
          </Link>
        }
      />
    );
  }
  return loading ? <ListSkeleton /> : null;
}
