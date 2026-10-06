"use client";
import { AssistantAccess } from "../connections";
import { useWorkspaceData } from "../crm/crm-context";
import { SettingsPanel } from "./settings-ui";

export function AssistantSettings() {
  const crm = useWorkspaceData();
  return (
    <SettingsPanel section="assistants">
      <AssistantAccess
        data={crm.data}
        endpoint={crm.mcpEndpoint}
        demo={crm.demo}
        onRevoke={crm.revokeGrant}
      />
    </SettingsPanel>
  );
}
