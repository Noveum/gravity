"use client";
import { useSearchParams } from "next/navigation";
import { useWorkspaceData } from "../crm/crm-context";
import { IntegrationCards } from "../integration-cards";
import { SettingsPanel } from "./settings-ui";

export function ConnectionSettings() {
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
    <SettingsPanel section="connections">
      <div className="integration-grid">
        <IntegrationCards
          key={`${crm.organizationId}:${crm.productId}`}
          data={crm.data}
          organizationId={crm.organizationId}
          productId={crm.productId}
          demo={crm.demo}
          initialNotice={notice}
          onChanged={crm.refresh}
          timeZone={crm.timeZone}
        />
      </div>
    </SettingsPanel>
  );
}
