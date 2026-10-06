import { resourceUrl } from "@crm/auth/options";
import { currentPrincipal } from "@crm/auth/server";
import { CrmService } from "@crm/core/crm";
import { serialize } from "@crm/core/dto";
import { DomainError, type Principal } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { demoId } from "@crm/database/seed";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CrmApp } from "@/components/crm-app";
import { requestPathHeader, signInPath } from "@/components/routes";
import {
  brandCookie,
  chooseBrand,
  chooseWorkspace,
  workspaceCookie,
} from "@/components/workspace-preference";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function CrmLayout({ children }: { children: ReactNode }) {
  let principal: Principal;
  const request = await headers();
  try {
    principal = await currentPrincipal(request);
  } catch (error) {
    if (error instanceof DomainError)
      redirect(signInPath(request.get(requestPathHeader)));
    throw error;
  }
  const service = new CrmService(await getDatabase());
  const organizations = await service.organizations(principal);
  if (!organizations.length) redirect("/onboarding");
  const store = await cookies();
  const organization = chooseWorkspace(
    organizations,
    store.get(workspaceCookie)?.value,
    isDemoMode() ? demoId(1) : "",
  );
  const snapshot = organization
    ? await service.snapshot(
        principal,
        { organizationId: organization.id },
        true,
      )
    : null;
  return (
    <CrmApp
      initial={snapshot ? serialize(snapshot) : null}
      organizations={organizations}
      mcpEndpoint={resourceUrl()}
      initialOrganizationId={organization?.id ?? ""}
      initialProductId={chooseBrand(
        snapshot?.products ?? [],
        store.get(brandCookie)?.value,
      )}
      userId={principal.userId}
      demo={isDemoMode()}
    >
      {children}
    </CrmApp>
  );
}
