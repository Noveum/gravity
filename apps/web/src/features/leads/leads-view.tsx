'use client';

import { leadFilterRegistry } from '@gravity/shared/filters';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ErrorState } from '@/components/ui/error-state.tsx';
import { ListSkeleton } from '@/components/ui/list-skeleton.tsx';
import { useListQuery } from '@/features/filters/use-list-query.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { useCopyLinkTarget } from '@/lib/copy-link.tsx';
import { rememberPipeline } from '@/lib/last-pipeline.ts';
import { useLeadList } from '@/lib/query/use-leads.ts';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';
import { LeadList } from './lead-list.tsx';

export function LeadsView({ pipelineKey }: { readonly pipelineKey: string }) {
  const workspace = useWorkspace();
  const key = pipelineKey.toUpperCase();
  const pipeline = workspace.pipelineByKey.get(key);
  const pipelineId = pipeline?.id ?? null;
  const fields = useMemo(() => workspace.fieldsFor('lead', pipelineId), [workspace, pipelineId]);
  const registry = useMemo(() => leadFilterRegistry(fields, pipelineId), [fields, pipelineId]);
  const views = useMemo(
    () =>
      workspace.savedViews.filter(
        (view) =>
          view.object === 'lead' && (view.pipelineId === null || view.pipelineId === pipelineId),
      ),
    [workspace.savedViews, pipelineId],
  );
  const listQuery = useListQuery(registry, views);
  const list = useLeadList(pipelineId, listQuery.query);
  const loading = useDelayedFlag(list.isPending && pipeline !== undefined);
  useCopyLinkTarget(null);
  useEffect(() => {
    if (pipeline !== undefined) rememberPipeline(workspace.userId, pipeline.key);
  }, [pipeline, workspace.userId]);

  if (!workspace.ready) return null;
  if (pipeline === undefined) {
    return (
      <EmptyState
        title={`There is no pipeline ${key}`}
        description="It may have been archived or its key changed."
        action={
          <Link href="/leads" className="font-medium text-accent text-dense">
            Go to your pipelines
          </Link>
        }
      />
    );
  }
  const brand = workspace.brandById.get(pipeline.brandId);

  if (list.error !== null) {
    return (
      <ErrorState
        title="Could not load the leads"
        error={list.error}
        onRetry={() => {
          list.refetch().catch(() => undefined);
        }}
      />
    );
  }
  if (list.isPending) return loading ? <ListSkeleton /> : null;
  if (list.leads.length === 0 && !listQuery.hasFilter) {
    return (
      <EmptyState
        title={`No leads in ${brand?.name ?? 'this brand'} · ${pipeline.name} yet.`}
        description="Press C to add a person, or import a CSV."
      />
    );
  }
  if (list.leads.length === 0) {
    return (
      <EmptyState
        title="No leads match these filters."
        description="Press Shift+F to clear them."
      />
    );
  }
  return (
    <LeadList pipeline={pipeline} stages={workspace.stagesOf(pipeline.id)} leads={list.leads} />
  );
}
