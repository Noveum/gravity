import t from "@crm/i18n/translations/en.json";
import { MaterialsView } from "@/components/views/materials-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.materials);
export default function Page() {
  return <MaterialsView />;
}
