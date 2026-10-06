import t from "@crm/i18n/translations/en.json";
import { InviteAccept } from "@/components/invite-accept";
export const metadata = {
  title: t.joinWorkspace,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return <InviteAccept />;
}
