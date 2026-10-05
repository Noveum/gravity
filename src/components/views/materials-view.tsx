"use client";
import { useWorkspaceData } from "../crm/crm-context";
import { Materials } from "../materials";

export function MaterialsView() {
  const crm = useWorkspaceData();
  return (
    <Materials
      data={crm.data}
      organizationId={crm.organizationId}
      productId={crm.productId}
      refresh={crm.refresh}
      onNotice={(text) => crm.notify(text, "success")}
      timeZone={crm.timeZone}
    />
  );
}
