"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
import { errorText, label, requestJson } from "./crm-app";

export function ActionDialog({
  data,
  organizationId,
  productId,
  relationshipId,
  userId,
  onClose,
  onCreated,
}: {
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  relationshipId: string;
  userId: string;
  onClose: () => void;
  onCreated: (result: {
    actionId: string;
    relationshipId: string;
  }) => Promise<void>;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const initial = data.relationships.find((r) => r.id === relationshipId);
  const [product, setProduct] = useState(
    initial?.productId || productId || data.products[0]?.id || "",
  );
  const [relationship, setRelationship] = useState(initial?.id || "");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    modal.current?.showModal();
  }, []);
  return (
    <dialog
      ref={modal}
      className="dialog action-dialog"
      aria-labelledby="action-dialog-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <h2 id="action-dialog-title">{t.scheduleAction}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fields = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const result = await requestJson<{
              actionId: string;
              relationshipId: string;
            }>("/api/crm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                operation: "schedule",
                organizationId,
                productId: product,
                relationshipId: relationship,
                ownerId: fields.get("ownerId"),
                kind: fields.get("kind"),
                channel: fields.get("channel"),
                owedBy: fields.get("owedBy"),
                title,
                reason: fields.get("reason") || "",
                dueAt: new Date(String(fields.get("dueAt"))).toISOString(),
              }),
            });
            await onCreated(result);
            onClose();
          } catch (error) {
            setError(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t.product}
          <select
            value={product}
            required
            onChange={(e) => {
              setProduct(e.target.value);
              setRelationship("");
            }}
          >
            {data.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.person}
          <select
            value={relationship}
            required
            onChange={(e) => setRelationship(e.target.value)}
          >
            <option value="">{t.chooseRelationship}</option>
            {data.relationships
              .filter((r) => r.productId === product)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {data.people.find((p) => p.id === r.personId)?.name} ·{" "}
                  {label(r.purpose)}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t.taskPreset}
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) setTitle(label(e.target.value));
            }}
          >
            <option value="">{t.customAction}</option>
            {["initialOutreach", "followup1", "followup2", "followup3"].map(
              (k) => (
                <option key={k} value={k}>
                  {label(k)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          {t.actionTitle}
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </label>
        <label>
          {t.owner}
          <select name="ownerId" defaultValue={userId} required>
            {data.members
              .filter((m) => m.productIds.includes(product))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t.dueDate}
          <input name="dueAt" type="datetime-local" required />
        </label>
        <label>
          {t.actionType}
          <select name="kind" defaultValue="review">
            {["reply", "approval", "review", "commitment", "research"].map(
              (k) => (
                <option key={k} value={k}>
                  {label(k)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          {t.channel}
          <select name="channel" defaultValue="gmail">
            {["gmail", "linkedin", "research"].map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.owedBy}
          <select name="owedBy" defaultValue="us">
            {["us", "them", "unknown"].map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.reason}
          <textarea name="reason" maxLength={10000} rows={3} />
        </label>
        <p className="muted">{t.scheduleNote}</p>
        <p role="status">{error}</p>
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || !relationship}
          >
            {busy ? t.saving : t.scheduleAction}
          </button>
        </div>
      </form>
    </dialog>
  );
}
