import t from "@crm/i18n/translations/en.json";
import { PersonRecord } from "@/components/records/person-record";
import { pageTitle } from "../../page-title";

export const metadata = pageTitle(t.person);
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonRecord key={id} personId={id} />;
}
