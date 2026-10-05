import t from "@crm/i18n/translations/en.json";
import { SettingsView } from "@/components/views/settings-view";
import { pageTitle } from "../page-title";

export const metadata = pageTitle(t.settings);
export default function Page() {
  return <SettingsView />;
}
