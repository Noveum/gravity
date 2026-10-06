"use client";
import type {
  ConnectionOverview,
  PublicConnection,
} from "@crm/connectors/service";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useWorkspaceData } from "../crm/crm-context";
import { settingsPath } from "../routes";
import { EmptyState } from "../ui/states";
import {
  QueryState,
  SettingsGroup,
  SettingsPanel,
  useSettingsQuery,
} from "./settings-ui";

const integrationsApi = "/api/integrations";
const sendingProviders = new Set(["gmail", "linkedin"]);

function ConnectionRow({
  connection,
  products,
  archivedProducts,
  onMove,
}: {
  connection: PublicConnection;
  products: { id: string; name: string }[];
  archivedProducts: { id: string; name: string }[];
  onMove: (productId: string) => void;
}) {
  const sender = sendingProviders.has(connection.provider);
  const known = products.some((product) => product.id === connection.productId);
  const archived = archivedProducts.find(
    (product) => product.id === connection.productId,
  );
  return (
    <li className="settings-row" aria-label={connection.displayName}>
      <span className="settings-row-main">
        <span>{connection.displayName}</span>
        <span className="settings-row-meta">{t[connection.provider]}</span>
        {connection.status !== "connected" && (
          <span className="badge warning">
            {connection.status === "disconnected"
              ? t.disconnected
              : t.reconnectRequired}
          </span>
        )}
        {sender && (
          <span className={`badge${connection.canSend ? "" : " warning"}`}>
            {connection.canSend ? t.canSendBadge : t.cannotSendBadge}
          </span>
        )}
      </span>
      <div className="settings-row-actions">
        <select
          aria-label={t.connectionProductFor.replace(
            "{name}",
            connection.displayName,
          )}
          value={connection.productId ?? ""}
          onChange={(event) => onMove(event.target.value)}
        >
          {!known && (
            <option value={connection.productId ?? ""} disabled={!!archived}>
              {archived?.name ?? t.unknown}
            </option>
          )}
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}

export function SendingSettings() {
  const crm = useWorkspaceData();
  const query = useSettingsQuery<ConnectionOverview>(
    crm.demo ? null : `${integrationsApi}?organizationId=${crm.organizationId}`,
    crm.sourceData.asOf,
  );
  const connections = query.data?.connections ?? [];
  const senders = connections.filter((row) =>
    sendingProviders.has(row.provider),
  );
  const others = connections.filter(
    (row) => !sendingProviders.has(row.provider),
  );
  const products = crm.sourceData.products;
  async function move(connectionId: string, productId: string) {
    const { ok } = await crm.send(
      {
        operation: "update-connection",
        organizationId: crm.organizationId,
        connectionId,
        productId,
      },
      t.connectionProductSaved,
      true,
      integrationsApi,
    );
    if (ok) await query.reload();
  }
  const list = (rows: PublicConnection[]) => (
    <ul className="settings-list">
      {rows.map((connection) => (
        <ConnectionRow
          key={`${connection.id}:${connection.productId}`}
          connection={connection}
          products={products}
          archivedProducts={crm.sourceData.archivedProducts ?? []}
          onMove={(productId) => void move(connection.id, productId)}
        />
      ))}
    </ul>
  );
  const connectionsLink = (
    <Link href={settingsPath("connections")} className="text-button">
      {t.openConnections}
    </Link>
  );
  return (
    <SettingsPanel section="sending">
      {crm.demo ? (
        <EmptyState title={t.integrationDemo} compact />
      ) : (
        <>
          <QueryState
            error={query.error}
            loading={query.loading}
            onRetry={() => void query.reload()}
          />
          {query.data && !connections.length && (
            <EmptyState title={t.sendingEmpty} action={connectionsLink} />
          )}
          {!!senders.length && (
            <SettingsGroup title={t.sendingAccounts} detail={t.sendingDetail}>
              {list(senders)}
              {senders.some(
                (row) => row.provider === "gmail" && !row.canSend,
              ) && (
                <p className="settings-note">
                  {t.mailboxSendUpgrade} {connectionsLink}
                </p>
              )}
            </SettingsGroup>
          )}
          {!!others.length && (
            <SettingsGroup
              title={t.otherConnections}
              detail={t.connectionProductDetail}
            >
              {list(others)}
            </SettingsGroup>
          )}
        </>
      )}
    </SettingsPanel>
  );
}
