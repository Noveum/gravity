import t from "@crm/i18n/translations/en.json";
import { OpportunitiesView } from "@/components/views/opportunities-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.opportunities);
export default function Page() {
  return <OpportunitiesView />;
}
