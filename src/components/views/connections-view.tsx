"use client";
import { Connections } from "../connections";
import { useWorkspaceData } from "../crm/crm-context";

export function ConnectionsView() {
  const crm = useWorkspaceData();
  return (
    <Connections
      data={crm.data}
      endpoint={crm.mcpEndpoint}
      demo={crm.demo}
      onRevoke={crm.revokeGrant}
    />
  );
}
