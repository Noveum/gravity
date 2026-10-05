import t from "@crm/i18n/translations/en.json";
import { MeetingsView } from "@/components/views/meetings-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.meetings);
export default function Page() {
  return <MeetingsView />;
}
