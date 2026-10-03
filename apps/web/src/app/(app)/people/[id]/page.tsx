import { PersonRecord } from '@/features/records/person-record.tsx';
import { pageContext } from '@/lib/api/handler.ts';

interface PageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PersonPage({ params, searchParams }: PageProps) {
  await pageContext();
  const { id } = await params;
  const lead = (await searchParams)['lead'];
  const focusLeadId = typeof lead === 'string' ? lead : null;
  return <PersonRecord key={`${id}:${focusLeadId}`} personId={id} focusLeadId={focusLeadId} />;
}
