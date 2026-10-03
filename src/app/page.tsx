import { currentPrincipal } from "@crm/auth/server";
import { CrmService } from "@crm/core/crm";
import { serialize } from "@crm/core/dto";
import { DomainError, type Principal } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { demoId } from "@crm/database/seed";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CrmApp } from "@/components/crm-app";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Page() {
  let principal: Principal;
  try {
    principal = await currentPrincipal(await headers());
  } catch (error) {
    if (error instanceof DomainError) redirect("/sign-in");
    throw error;
  }
  const service = new CrmService(await getDatabase());
  const organizations = await service.organizations(principal);
  const organization =
    organizations.find((org) => isDemoMode() && org.id === demoId(1)) ??
    organizations[0];
  const snapshot = organization
    ? await service.snapshot(principal, { organizationId: organization.id })
    : null;
  return (
    <CrmApp
      initial={snapshot ? serialize(snapshot) : null}
      organizations={organizations}
      initialOrganizationId={organization?.id ?? ""}
      userId={principal.userId}
      demo={isDemoMode()}
    />
  );
}
