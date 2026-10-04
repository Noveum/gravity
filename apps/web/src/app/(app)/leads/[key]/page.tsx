import { WORKSPACE_LINK_PARAM } from '@gravity/shared/utils';
import { HydrationBoundary } from '@tanstack/react-query';
import { LeadsView } from '@/features/leads/leads-view.tsx';
import { linkedPageContext } from '@/lib/api/workspace-link.ts';
import { dehydratedLeads } from '@/lib/query/prefetch.ts';

interface PageProps {
  readonly params: Promise<{ key: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PipelineLeadsPage({ params, searchParams }: PageProps) {
  const { key } = await params;
  const raw = await searchParams;
  const context = await linkedPageContext(`/leads/${encodeURIComponent(key)}`, raw);
  const search = new URLSearchParams(
    Object.entries(raw).flatMap(([name, value]) =>
      typeof value === 'string' && name !== WORKSPACE_LINK_PARAM ? [[name, value]] : [],
    ),
  ).toString();
  const state = await dehydratedLeads(context, key, search);
  return (
    <HydrationBoundary state={state}>
      <LeadsView pipelineKey={key.toUpperCase()} />
    </HydrationBoundary>
  );
}
