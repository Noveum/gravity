"use client";
import t from "@crm/i18n/translations/en.json";
import { dateLabel } from "../client-api";
import { AssistantAccess } from "../connections";
import { useWorkspaceData } from "../crm/crm-context";
import { EmptyState } from "../ui/states";
import {
  ConfirmButton,
  QueryState,
  SettingsGroup,
  SettingsPanel,
  useSettingsQuery,
} from "./settings-ui";

interface WorkspaceGrant {
  id: string;
  userId: string;
  name: string;
  email: string;
  productIds: string[];
  createdAt: string;
}

function WorkspaceGrants() {
  const crm = useWorkspaceData();
  const query = useSettingsQuery<{ grants: WorkspaceGrant[] }>(
    `/api/crm?operation=assistant-grants&organizationId=${crm.organizationId}`,
    crm.sourceData.asOf,
  );
  const scope = (productIds: string[]) =>
    productIds.length === 1 && productIds[0] === "*"
      ? t.allProductsAndFuture
      : productIds
          .map((id) => crm.product(id)?.name)
          .filter(Boolean)
          .join(", ");
  const grants = query.data?.grants ?? [];
  return (
    <SettingsGroup title={t.workspaceGrants} detail={t.workspaceGrantsDetail}>
      <QueryState
        error={query.error}
        loading={query.loading}
        onRetry={() => void query.reload()}
        rows={2}
      />
      {query.data && !grants.length && (
        <EmptyState title={t.workspaceGrantsEmpty} compact />
      )}
      <ul className="settings-list">
        {grants.map((grant) => (
          <li key={grant.id} className="settings-row" aria-label={grant.name}>
            <span className="settings-row-main">
              <strong>{grant.name}</strong>
              <span className="settings-row-meta">
                {scope(grant.productIds)}
              </span>
            </span>
            <span className="settings-row-meta">
              {t.grantSince.replace(
                "{date}",
                dateLabel(grant.createdAt, crm.timeZone),
              )}
            </span>
            <div className="settings-row-actions">
              <ConfirmButton
                label={t.revoke}
                ariaLabel={t.revokeFor.replace("{name}", grant.name)}
                confirmLabel={t.revokeGrantConfirm}
                onConfirm={async () => {
                  if (await crm.revokeGrant(grant.id)) await query.reload();
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}

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
      {crm.isAdmin && <WorkspaceGrants />}
    </SettingsPanel>
  );
}
