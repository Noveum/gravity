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
      onError={(text) => crm.notify(text, "danger")}
      timeZone={crm.timeZone}
      registerCreate={crm.registerCreate}
      canLeaveEditor={crm.canLeaveEditor}
    />
  );
}
