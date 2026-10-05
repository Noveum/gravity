"use client";
import { useSearchParams } from "next/navigation";
import { Connections } from "../connections";
import { useWorkspaceData } from "../crm/crm-context";

export function ConnectionsView() {
  const crm = useWorkspaceData();
  const query = useSearchParams();
  const notice =
    query.get("integrationError") ??
    (query.get("integration") === "pending"
      ? "CONNECTION_PENDING"
      : query.get("integration") === "connected"
        ? "CONNECTION_CONNECTED"
        : "");
  return (
    <Connections
      data={crm.data}
      endpoint={crm.mcpEndpoint}
      demo={crm.demo}
      onRevoke={crm.revokeGrant}
      organizationId={crm.organizationId}
      productId={crm.productId}
      initialNotice={notice}
      onChanged={crm.refresh}
      timeZone={crm.timeZone}
    />
  );
}
