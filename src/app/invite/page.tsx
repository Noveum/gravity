import t from "@crm/i18n/translations/en.json";
import type { Metadata } from "next";
import { InviteFlow } from "@/components/invite-acceptance";

export const metadata: Metadata = {
  title: `${t.invitePageTitle} · ${t.brand}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return <InviteFlow />;
}
