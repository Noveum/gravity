import t from "@crm/i18n/translations/en.json";
import { CompaniesView } from "@/components/views/companies-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.companies);
export default function Page() {
  return <CompaniesView />;
}
