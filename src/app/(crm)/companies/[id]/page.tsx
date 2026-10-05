import t from "@crm/i18n/translations/en.json";
import { CompanyRecord } from "@/components/records/company-record";
import { pageTitle } from "../../page-title";

export const metadata = pageTitle(t.company);
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CompanyRecord key={id} companyId={id} />;
}
