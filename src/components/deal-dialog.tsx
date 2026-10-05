"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useRef, useState } from "react";
import { errorText, requestJson } from "./client-api";
import { useWorkspaceData } from "./crm/crm-context";
import {
  submitOnSaveKey,
  useModalLifecycle,
  useReadyFocus,
} from "./modal-lifecycle";
import { OpportunityDialog } from "./records/record-dialogs";

export function DealDialog({
  deal,
  onClose,
}: {
  deal?: ClientSnapshot["opportunities"][number];
  onClose: () => void;
}) {
  return <OpportunityDialog opportunity={deal} onClose={onClose} />;
}

export function PipelineDialog({ onClose }: { onClose: () => void }) {
  const crm = useWorkspaceData();
  const modal = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useModalLifecycle(modal);
  useReadyFocus(modal, false);
  return (
    <dialog
      ref={modal}
      className="dialog"
      aria-labelledby="pipeline-dialog-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <h2 id="pipeline-dialog-title">{t.newPipeline}</h2>
      <p>{t.pipelineHelp}</p>
      <form
        onKeyDown={submitOnSaveKey}
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            await requestJson("/api/crm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                operation: "pipeline",
                organizationId: crm.organizationId,
                productId: f.get("productId"),
                name: f.get("name"),
              }),
            });
            await crm.refresh();
            crm.notify(t.pipelineCreated, "success");
            onClose();
          } catch (cause) {
            setError(errorText(cause));
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset className="dialog-fields" disabled={busy}>
          <label>
            {t.product}
            <select
              name="productId"
              defaultValue={crm.productId || crm.data.products[0]?.id}
            >
              {crm.data.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.name}
            <input name="name" data-primary-field required maxLength={100} />
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? t.saving : t.createPipeline}
          </button>
        </div>
      </form>
    </dialog>
  );
}
