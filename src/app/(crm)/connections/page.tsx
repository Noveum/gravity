import t from "@crm/i18n/translations/en.json";
import { ConnectionsView } from "@/components/views/connections-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.integrations);
export default function Page() {
  return <ConnectionsView />;
}
