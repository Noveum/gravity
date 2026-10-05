"use client";
import { AssistantAccess } from "../connections";
import { useWorkspaceData } from "../crm/crm-context";

export function AssistantsView() {
  const crm = useWorkspaceData();
  return (
    <div className="page-content integration-grid">
      <AssistantAccess
        data={crm.data}
        endpoint={crm.mcpEndpoint}
        demo={crm.demo}
        onRevoke={crm.revokeGrant}
      />
    </div>
  );
}
