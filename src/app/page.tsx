import { resourceUrl } from "@crm/auth/options";
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
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let principal: Principal;
  try {
    principal = await currentPrincipal(await headers());
  } catch (error) {
    if (error instanceof DomainError) redirect("/sign-in");
    throw error;
  }
  const service = new CrmService(await getDatabase());
  const organizations = await service.organizations(principal);
  if (!organizations.length) redirect("/onboarding");
  const query = await searchParams;
  const requested =
    typeof query.organizationId === "string" ? query.organizationId : "";
  const organization =
    organizations.find((org) => org.id === requested) ??
    organizations.find((org) => isDemoMode() && org.id === demoId(1)) ??
    organizations[0];
  const snapshot = organization
    ? await service.snapshot(principal, { organizationId: organization.id })
    : null;
  return (
    <CrmApp
      initial={snapshot ? serialize(snapshot) : null}
      initialView={query.view === "connections" ? "integrations" : "actions"}
      integrationNotice={
        typeof query.integrationError === "string"
          ? query.integrationError
          : query.integration === "pending"
            ? "CONNECTION_PENDING"
            : query.integration === "connected"
              ? "CONNECTION_CONNECTED"
              : ""
      }
      organizations={organizations}
      mcpEndpoint={resourceUrl()}
      initialOrganizationId={organization?.id ?? ""}
      initialProductId={
        typeof query.productId === "string" &&
        snapshot?.products.some((product) => product.id === query.productId)
          ? query.productId
          : ""
      }
      userId={principal.userId}
      demo={isDemoMode()}
    />
  );
}
