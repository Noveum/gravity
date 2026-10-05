import t from "@crm/i18n/translations/en.json";
import { OverviewView } from "@/components/views/overview-view";
import { pageTitle } from "../page-title";
export const metadata = pageTitle(t.overview);
export default function Page() {
  return <OverviewView />;
}
