import { CompanyRecord } from '@/features/records/company-record.tsx';
import { linkedPageContext, type PageSearchParams } from '@/lib/api/workspace-link.ts';

export default async function CompanyPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<PageSearchParams>;
}) {
  const { id } = await params;
  await linkedPageContext(`/companies/${encodeURIComponent(id)}`, await searchParams);
  return <CompanyRecord key={id} companyId={id} />;
}
