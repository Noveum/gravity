import t from "@crm/i18n/translations/en.json";
import { SequencesView } from "@/components/views/sequences-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.sequences);
export default function Page() {
  return <SequencesView />;
}
