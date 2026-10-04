import { PersonRecord } from '@/features/records/person-record.tsx';
import { linkedPageContext } from '@/lib/api/workspace-link.ts';

interface PageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PersonPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  await linkedPageContext(`/people/${encodeURIComponent(id)}`, query);
  const lead = query['lead'];
  const focusLeadId = typeof lead === 'string' ? lead : null;
  return <PersonRecord key={`${id}:${focusLeadId}`} personId={id} focusLeadId={focusLeadId} />;
}
