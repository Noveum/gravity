import t from "@crm/i18n/translations/en.json";
import { AssistantsView } from "@/components/views/assistants-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.assistants);
export default function Page() {
  return <AssistantsView />;
}
