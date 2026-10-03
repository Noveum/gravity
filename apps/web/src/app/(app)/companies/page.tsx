import { CompaniesView } from '@/features/companies/companies-view.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export default async function CompaniesPage() {
  await pageContext();
  return <CompaniesView />;
}
