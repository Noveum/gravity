'use client';

import { leadFilterRegistry } from '@gravity/shared/filters';
import { Columns3, Rows3 } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ErrorState } from '@/components/ui/error-state.tsx';
import { ListSkeleton } from '@/components/ui/list-skeleton.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { leadViewsFor } from '@/features/filters/list-query.ts';
import { ListToolbar } from '@/features/filters/list-toolbar.tsx';
import { useListQuery } from '@/features/filters/use-list-query.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { useCopyLinkTarget } from '@/lib/copy-link.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { rememberPipeline } from '@/lib/last-pipeline.ts';
import { useLeadList } from '@/lib/query/use-leads.ts';
import { useRetryToast } from '@/lib/query/use-retry-toast.ts';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';
import { BoardSkeleton, LeadBoard } from './lead-board.tsx';
import { LeadList } from './lead-list.tsx';
import { LeadVerbs } from './lead-verbs.tsx';
import { useLeadsLayout } from './use-leads-layout.ts';

export function LeadsView({ pipelineKey }: { readonly pipelineKey: string }) {
  const workspace = useWorkspace();
  const key = pipelineKey.toUpperCase();
  const pipeline = workspace.pipelineByKey.get(key);
  const pipelineId = pipeline?.id ?? null;
  const fields = useMemo(() => workspace.fieldsFor('lead', pipelineId), [workspace, pipelineId]);
  const registry = useMemo(() => leadFilterRegistry(fields, pipelineId), [fields, pipelineId]);
  const views = useMemo(
    () => leadViewsFor(workspace.savedViews, pipelineId),
    [workspace.savedViews, pipelineId],
  );
  const stages = useMemo(
    () => (pipelineId === null ? [] : workspace.stagesOf(pipelineId)),
    [workspace, pipelineId],
  );
  const sources = useMemo(
    () => ({ stages, members: workspace.members }),
    [stages, workspace.members],
  );
  const listQuery = useListQuery(registry, views);
  const list = useLeadList(pipelineId, listQuery.query);
  const loading = useDelayedFlag(list.isPending && pipeline !== undefined);
  const hasData = list.data !== undefined;
  const retryToast = useRetryToast();
  const { error, refetch } = list;
  useEffect(() => {
    if (error === null || !hasData) return;
    retryToast('Could not refresh the leads', error, () => {
      refetch().catch(() => undefined);
    });
  }, [error, hasData, retryToast, refetch]);
  useCopyLinkTarget(null);
  const { layout, toggle } = useLeadsLayout(pipelineId ?? '');
  useHotkey('v', toggle, {
    label: 'Toggle list and board',
    section: 'View',
    scope: 'records',
    enabled: pipeline !== undefined,
  });
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
  const framed = (state: ReactNode) => (
    <div className="flex h-full min-h-0 flex-col">
      <ListToolbar
        object="lead"
        pipelineId={pipeline.id}
        registry={registry}
        sources={sources}
        state={listQuery}
      >
        <Tooltip
          label={layout === 'list' ? 'Show as board' : 'Show as list'}
          shortcut={['v']}
          side="bottom"
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={toggle}
            aria-label={layout === 'list' ? 'Show as board' : 'Show as list'}
            className="size-7 px-0"
          >
            {layout === 'list' ? (
              <Columns3 className="size-3.5" aria-hidden="true" />
            ) : (
              <Rows3 className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
      </ListToolbar>
      {state}
    </div>
  );

  if (list.error !== null && !hasData) {
    return framed(
      <ErrorState
        title="Could not load the leads"
        error={list.error}
        onRetry={() => {
          list.refetch().catch(() => undefined);
        }}
      />,
    );
  }
  const board = layout === 'board';
  if (list.isPending) {
    if (!loading) return framed(null);
    return framed(board ? <BoardSkeleton /> : <ListSkeleton />);
  }
  if (list.leads.length === 0 && !listQuery.hasFilter) {
    return framed(
      <EmptyState
        title={`No leads in ${brand?.name ?? 'this brand'} · ${pipeline.name} yet.`}
        description="Press C to add a person, or import a CSV."
      />,
    );
  }
  if (board) {
    return framed(
      <div className="min-h-0 flex-1">
        <LeadBoard pipeline={pipeline} stages={stages} leads={list.leads} />
      </div>,
    );
  }
  if (list.leads.length === 0) {
    return framed(
      <EmptyState
        title="No leads match these filters."
        description="Press Shift+F to clear them, or change the filters above."
      />,
    );
  }
  return framed(
    <div className="min-h-0 flex-1">
      <LeadList
        pipeline={pipeline}
        stages={stages}
        leads={list.leads}
        renderActions={(selection) => <LeadVerbs selection={selection} pipelineId={pipeline.id} />}
      />
    </div>,
  );
}
