import { CompanyRecord } from '@/features/records/company-record.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function CompanyPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  await pageContext();
  const { id } = await params;
  return <CompanyRecord key={id} companyId={id} />;
}
