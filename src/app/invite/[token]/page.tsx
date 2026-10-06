import t from "@crm/i18n/translations/en.json";
import type { Metadata } from "next";
import { LegacyInviteRedirect } from "@/components/invite-acceptance";

export const metadata: Metadata = {
  title: `${t.invitePageTitle} · ${t.brand}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <LegacyInviteRedirect token={token} />;
}
