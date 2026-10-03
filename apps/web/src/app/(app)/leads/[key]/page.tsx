import { decodeListQuery } from '@gravity/shared/filters';
import { HydrationBoundary } from '@tanstack/react-query';
import { LeadsView } from '@/features/leads/leads-view.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { dehydratedLeads } from '@/lib/query/prefetch.ts';

interface PageProps {
  readonly params: Promise<{ key: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PipelineLeadsPage({ params, searchParams }: PageProps) {
  const context = await pageContext();
  const { key } = await params;
  const raw = await searchParams;
  const search = new URLSearchParams(
    Object.entries(raw).flatMap(([name, value]) =>
      typeof value === 'string' ? [[name, value]] : [],
    ),
  ).toString();
  const state = await dehydratedLeads(context, key, decodeListQuery(search));
  return (
    <HydrationBoundary state={state}>
      <LeadsView pipelineKey={key.toUpperCase()} />
    </HydrationBoundary>
  );
}
