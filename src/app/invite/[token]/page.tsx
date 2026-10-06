import { currentPrincipal } from "@crm/auth/server";
import { DomainError } from "@crm/core/policy";
import t from "@crm/i18n/translations/en.json";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { InviteAccept } from "@/components/invite-accept";
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
  const valid = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .safeParse(token);
  if (!valid.success) return <InviteAccept token="" />;
  try {
    await currentPrincipal(await headers());
  } catch (error) {
    if (error instanceof DomainError && error.status === 401)
      redirect(
        `/sign-in?callbackURL=${encodeURIComponent(`/invite/${token}`)}`,
      );
    throw error;
  }
  return <InviteAccept token={token} />;
}
