'use client';

import type { FilterRegistry } from '@gravity/shared/filters';
import { useEffect, useMemo } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ErrorState } from '@/components/ui/error-state.tsx';
import { ListToolbar } from '@/features/filters/list-toolbar.tsx';
import { type ListQueryState, useListQuery } from '@/features/filters/use-list-query.ts';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { useCopyLinkTarget } from '@/lib/copy-link.tsx';
import { useRetryToast } from '@/lib/query/use-retry-toast.ts';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';
import { RecordList, type RecordListProps, RecordListSkeleton } from './record-list.tsx';

export type RecordObject = 'person' | 'company';

export function useRecordListQuery<T>(
  object: RecordObject,
  registry: FilterRegistry<T>,
): ListQueryState {
  const workspace = useWorkspace();
  const views = useMemo(
    () => workspace.savedViews.filter((view) => view.object === object),
    [workspace.savedViews, object],
  );
  return useListQuery(registry, views);
}

export interface RecordListCopy {
  readonly errorTitle: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly filteredTitle: string;
}

export interface RecordListResult {
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly data: unknown;
  readonly refetch: () => Promise<unknown>;
}

export interface RecordListViewProps<T extends { readonly id: string }> extends RecordListProps<T> {
  readonly object: RecordObject;
  readonly registry: FilterRegistry<T>;
  readonly state: ListQueryState;
  readonly result: RecordListResult;
  readonly copy: RecordListCopy;
}

export function RecordListView<T extends { readonly id: string }>({
  object,
  registry,
  state,
  result,
  copy,
  ...list
}: RecordListViewProps<T>) {
  const workspace = useWorkspace();
  const sources = useMemo(() => ({ stages: [], members: workspace.members }), [workspace.members]);
  const loading = useDelayedFlag(result.isPending);
  const hasData = result.data !== undefined;
  const retryToast = useRetryToast();
  const { error, refetch } = result;
  const retry = () => {
    refetch().catch(() => undefined);
  };
  useEffect(() => {
    if (error === null || !hasData) return;
    retryToast(copy.errorTitle, error, () => {
      refetch().catch(() => undefined);
    });
  }, [error, hasData, retryToast, refetch, copy.errorTitle]);
  useCopyLinkTarget(null);

  function body() {
    if (error !== null && !hasData) {
      return <ErrorState title={copy.errorTitle} error={error} onRetry={retry} />;
    }
    if (result.isPending) return loading ? <RecordListSkeleton /> : null;
    if (list.rows.length === 0 && !state.hasFilter) {
      return <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />;
    }
    if (list.rows.length === 0) {
      return <EmptyState title={copy.filteredTitle} description="Press Shift+F to clear them." />;
    }
    return <RecordList {...list} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListToolbar
        object={object}
        pipelineId={null}
        registry={registry}
        sources={sources}
        state={state}
      />
      <div className="min-h-0 flex-1">{body()}</div>
    </div>
  );
}
