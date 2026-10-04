import { LeadsIndex } from '@/features/leads/leads-index.tsx';
import {
  linkedPageContext,
  linkedSlugOf,
  type PageSearchParams,
} from '@/lib/api/workspace-link.ts';

export default async function LeadsIndexPage({
  searchParams,
}: {
  readonly searchParams: Promise<PageSearchParams>;
}) {
  const query = await searchParams;
  if (linkedSlugOf(query) !== null) await linkedPageContext('/leads', query);
  return <LeadsIndex />;
}
