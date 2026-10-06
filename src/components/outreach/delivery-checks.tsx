"use client";
import type { OutboundService } from "@crm/connectors/outbound";
import type { JsonValue } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useCallback, useEffect, useState } from "react";
import { dateLabel, label, requestJson } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { RecordDialog, text } from "../records/record-dialog";
import { initials } from "../shell/workspace-menu";
import { useOutreachSend } from "./outreach-data";
import { TouchGroup } from "./touch-lists";

export type DeliveryCheck = JsonValue<
  Awaited<ReturnType<OutboundService["list"]>>
>["items"][number];
type Settling = { kind: "reconcile" | "resolve"; delivery: DeliveryCheck };

const outcomes = ["sent", "failed"] as const;
const reasons = [
  "confirmed_in_provider",
  "absent_in_provider",
  "recipient_confirmed",
  "written_off",
] as const;

export function useDeliveryChecks() {
  const { organizationId, productId, sourceData } = useCrm();
  const asOf = sourceData?.asOf;
  const [items, setItems] = useState<DeliveryCheck[]>([]);
  const reload = useCallback(async () => {
    if (!organizationId) return;
    const scope = new URLSearchParams({
      operation: "deliveries",
      organizationId,
    });
    if (productId) scope.set("productId", productId);
    try {
      const result = await requestJson<{ items: DeliveryCheck[] }>(
        `/api/outreach?${scope}`,
      );
      setItems(result.items);
    } catch {
      setItems([]);
    }
  }, [organizationId, productId]);
  useEffect(() => {
    if (asOf) void reload();
  }, [reload, asOf]);
  return { items, reload };
}

export function DeliveryChecks({
  items,
  reload,
}: {
  items: readonly DeliveryCheck[];
  reload: () => Promise<void>;
}) {
  const crm = useCrm();
  const send = useOutreachSend();
  const [settling, setSettling] = useState<Settling | null>(null);
  const nameOf = (delivery: DeliveryCheck) =>
    crm.personFor(delivery.relationshipId)?.name ?? t.unknown;
  async function reconcile(delivery: DeliveryCheck, fields: FormData) {
    const externalMessageId = text(fields, "externalMessageId");
    const result = await send<{ status: string }>({
      operation: "reconcile-delivery",
      deliveryId: delivery.id,
      ...(externalMessageId ? { externalMessageId } : {}),
    });
    if (!result.ok) return result.error;
    crm.notify(t.reconciled.replace("{name}", nameOf(delivery)), "success");
    await reload();
    return null;
  }
  async function resolve(delivery: DeliveryCheck, fields: FormData) {
    if (fields.get("confirm") !== "on") return t.resolveConfirmRequired;
    const result = await send({
      operation: "resolve-delivery",
      deliveryId: delivery.id,
      outcome: text(fields, "outcome"),
      reason: text(fields, "reason"),
      confirm: true,
    });
    if (!result.ok) return result.error;
    crm.notify(t.resolved.replace("{name}", nameOf(delivery)), "success");
    await reload();
    return null;
  }
  if (!items.length) return null;
  return (
    <>
      <TouchGroup title={t.deliveryChecks} count={items.length}>
        <p className="muted delivery-checks-note">{t.deliveryChecksDetail}</p>
        <ul className="delivery-checks">
          {items.map((delivery) => {
            const name = nameOf(delivery);
            return (
              <li className="delivery-row" key={delivery.id}>
                <span className="row-avatar" aria-hidden>
                  {initials(name)}
                </span>
                <span className="row-name">{name}</span>
                <span className="badge warning">
                  {t.deliveryStatus[
                    delivery.status as keyof typeof t.deliveryStatus
                  ] ?? delivery.status}
                </span>
                <span className="row-kind">{label(delivery.channel)}</span>
                {delivery.ownerId !== crm.userId && (
                  <span className="row-company">
                    {t.deliverySender.replace(
                      "{name}",
                      crm.member(delivery.ownerId),
                    )}
                  </span>
                )}
                <span className="row-meta">
                  {dateLabel(delivery.createdAt, crm.timeZone)}
                </span>
                <span className="delivery-actions">
                  {delivery.canReconcile && (
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`${t.reconcile}: ${name}`}
                      onClick={() =>
                        setSettling({ kind: "reconcile", delivery })
                      }
                    >
                      {t.reconcile}
                    </button>
                  )}
                  {delivery.canResolve && (
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`${t.resolve}: ${name}`}
                      onClick={() => setSettling({ kind: "resolve", delivery })}
                    >
                      {t.resolve}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </TouchGroup>
      {settling?.kind === "reconcile" && (
        <RecordDialog
          title={t.reconcileTitle.replace("{name}", nameOf(settling.delivery))}
          submitLabel={t.reconcile}
          onClose={() => setSettling(null)}
          onSubmit={(fields) => reconcile(settling.delivery, fields)}
        >
          <p className="muted">{t.reconcileDetail}</p>
          {settling.delivery.channel === "linkedin" && (
            <>
              <label>
                {t.reconcileMessageId}
                <input
                  name="externalMessageId"
                  maxLength={500}
                  data-primary-field
                />
              </label>
              <small className="field-hint muted">
                {t.reconcileMessageIdHint}
              </small>
            </>
          )}
        </RecordDialog>
      )}
      {settling?.kind === "resolve" && (
        <RecordDialog
          title={t.resolveTitle.replace("{name}", nameOf(settling.delivery))}
          submitLabel={t.resolve}
          onClose={() => setSettling(null)}
          onSubmit={(fields) => resolve(settling.delivery, fields)}
        >
          <p className="muted">{t.resolveDetail}</p>
          <label>
            {t.resolveOutcome}
            <select name="outcome" defaultValue="sent" data-primary-field>
              {outcomes
                .filter(
                  (outcome) =>
                    outcome === "sent" || !settling.delivery.providerAccepted,
                )
                .map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {t.resolveOutcomes[outcome]}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t.resolveReason}
            <select name="reason" defaultValue="confirmed_in_provider">
              {reasons.map((reason) => (
                <option key={reason} value={reason}>
                  {t.resolveReasons[reason]}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input name="confirm" type="checkbox" required />
            {t.resolveConfirm}
          </label>
        </RecordDialog>
      )}
    </>
  );
}
