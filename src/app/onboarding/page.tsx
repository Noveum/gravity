import { currentPrincipal } from "@crm/auth/server";
import { DomainError } from "@crm/core/policy";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { WorkspaceSetup } from "@/components/workspace-setup";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const oauthQuery =
    typeof query.oauth_query === "string" && query.oauth_query.length <= 10000
      ? query.oauth_query
      : "";
  const callback = `/onboarding${oauthQuery ? `?oauth_query=${encodeURIComponent(oauthQuery)}` : ""}`;
  try {
    await currentPrincipal(await headers());
  } catch (error) {
    if (error instanceof DomainError)
      redirect(`/sign-in?callbackURL=${encodeURIComponent(callback)}`);
    throw error;
  }
  return <WorkspaceSetup oauthQuery={oauthQuery} />;
}
