import t from "@crm/i18n/translations/en.json";
import { ActionsView } from "@/components/views/actions-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.actions);
export default function Page() {
  return <ActionsView />;
}
