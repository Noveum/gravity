import t from "@crm/i18n/translations/en.json";
import { OutreachView } from "@/components/views/outreach-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.outreach);
export default function Page() {
  return <OutreachView />;
}
