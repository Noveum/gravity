'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { rememberPipeline } from '@/lib/last-pipeline.ts';

export function LeadsView({ pipelineKey }: { readonly pipelineKey: string }) {
  const workspace = useWorkspace();
  const pipeline = workspace.pipelineByKey.get(pipelineKey);
  useEffect(() => {
    if (pipeline !== undefined) rememberPipeline(workspace.userId, pipeline.key);
  }, [pipeline, workspace.userId]);
  if (!workspace.ready) return null;
  if (pipeline === undefined) {
    return (
      <EmptyState
        title={`There is no pipeline ${pipelineKey}`}
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
  return (
    <EmptyState
      title={`${brand?.name ?? 'Brand'} · ${pipeline.name}`}
      description="Leads for this pipeline appear here."
    />
  );
}
