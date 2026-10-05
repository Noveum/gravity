import t from "@crm/i18n/translations/en.json";
import { PeopleView } from "@/components/views/people-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.people);
export default function Page() {
  return <PeopleView />;
}
