import t from "@crm/i18n/translations/en.json";
import { LegacyInviteRedirect } from "@/components/invite-accept";
export const dynamic = "force-dynamic";
export const metadata = {
  title: t.joinWorkspace,
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
