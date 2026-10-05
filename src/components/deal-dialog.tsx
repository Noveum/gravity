"use client";
import { currencyDigits, parseMoney } from "@crm/core/analytics";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { BriefcaseBusiness, X } from "lucide-react";
import { useRef, useState } from "react";
import { errorText, requestJson } from "./client-api";
import { useWorkspaceData } from "./crm/crm-context";
import { useDialogSnapshot } from "./dialog-snapshot";
import {
  submitOnModEnter,
  useModalLifecycle,
  useReadyFocus,
} from "./modal-lifecycle";
import { ShortcutHint } from "./ui/shortcut-hint";

export function DealDialog({
  deal,
  onClose,
}: {
  deal?: ClientSnapshot["opportunities"][number];
  onClose: () => void;
}) {
  const crm = useWorkspaceData();
  const modal = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const {
    data,
    loading,
    error: loadError,
    retry,
  } = useDialogSnapshot(crm.data, crm.organizationId);
  const [productId, setProduct] = useState(
    deal?.productId ?? crm.productId ?? "",
  );
  const product = productId || data.products[0]?.id || "";
  const [stageId, setStage] = useState(deal?.stageId ?? "");
  const stages = data.stages.filter((s) => s.productId === product);
  const stage =
    stages.find((s) => s.id === stageId) ??
    stages.find((s) => s.kind === "open");
  const [pipelineId, setPipeline] = useState(stage?.pipelineId ?? "");
  const pipeline =
    pipelineId ||
    stage?.pipelineId ||
    data.pipelines.find((p) => p.productId === product)?.id ||
    "";
  const [currency, setCurrency] = useState(deal?.currency ?? "USD");
  const [amount, setAmount] = useState(
    deal?.amountMinor != null
      ? String(deal.amountMinor / 10 ** currencyDigits(deal.currency))
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useModalLifecycle(modal);
  useReadyFocus(modal, loading);
  return (
    <dialog
      ref={modal}
      className="dialog deal-dialog"
      aria-labelledby="deal-dialog-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="section-heading">
        <h2 id="deal-dialog-title">
          <BriefcaseBusiness size={18} aria-hidden />
          {deal ? t.editDeal : t.newDeal}
        </h2>
        <button
          type="button"
          aria-label={t.close}
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <form
        onKeyDown={submitOnModEnter}
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current || loading || loadError) return;
          submitting.current = true;
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await requestJson("/api/crm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                operation: "opportunity",
                organizationId: crm.organizationId,
                id: deal?.id,
                version: deal?.version,
                productId: product,
                relationshipId: f.get("relationshipId"),
                stageId: stage?.id,
                status: stage?.kind ?? "open",
                name: f.get("name"),
                ownerId: f.get("ownerId"),
                amountMinor: parseMoney(
                  String(f.get("amount") ?? ""),
                  currency,
                ),
                currency,
                probability:
                  f.get("probability") === ""
                    ? null
                    : Number(f.get("probability")),
                expectedCloseDate: f.get("expectedCloseDate") || null,
                description: f.get("description"),
                lostReason: f.get("lostReason") ?? "",
              }),
            });
            await crm.refresh();
            crm.notify(t.dealSaved, "success");
            onClose();
          } catch (cause) {
            setError(errorText(cause));
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset
          className="dialog-fields"
          disabled={busy || loading || !!loadError}
        >
          <label>
            {t.dealName}
            <input
              name="name"
              data-primary-field
              required
              maxLength={200}
              defaultValue={deal?.name ?? ""}
            />
          </label>
          <div className="form-columns">
            <label>
              {t.product}
              <select
                value={product}
                disabled={!!deal}
                onChange={(e) => {
                  setProduct(e.target.value);
                  setStage("");
                  setPipeline("");
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
                key={product}
                name="relationshipId"
                required
                defaultValue={deal?.relationshipId ?? ""}
                disabled={!!deal}
              >
                {deal && (
                  <option value={deal.relationshipId}>
                    {crm.personFor(deal.relationshipId)?.name}
                  </option>
                )}
                {!deal && (
                  <>
                    <option value="">{t.chooseRelationship}</option>
                    {data.relationships
                      .filter((r) => r.productId === product)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {data.people.find((p) => p.id === r.personId)?.name} ·{" "}
                          {r.purpose}
                        </option>
                      ))}
                  </>
                )}
              </select>
              {deal && (
                <input
                  type="hidden"
                  name="relationshipId"
                  value={deal.relationshipId}
                />
              )}
            </label>
          </div>
          <div className="form-columns">
            <label>
              {t.pipeline}
              <select
                value={pipeline}
                onChange={(e) => {
                  setPipeline(e.target.value);
                  setStage(
                    stages.find(
                      (s) =>
                        s.pipelineId === e.target.value && s.kind === "open",
                    )?.id ?? "",
                  );
                }}
              >
                {data.pipelines
                  .filter((p) => p.productId === product)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t.stage}
              <select
                value={stage?.id ?? ""}
                onChange={(e) => setStage(e.target.value)}
              >
                {stages
                  .filter((s) => !pipeline || s.pipelineId === pipeline)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            {t.owner}
            <select
              name="ownerId"
              defaultValue={
                deal?.ownerId ??
                data.relationships.find((r) => r.id === deal?.relationshipId)
                  ?.ownerId ??
                crm.userId
              }
              required
            >
              {data.members
                .filter((m) => m.productIds.includes(product))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="form-columns">
            <label>
              {t.dealAmount}
              <input
                name="amount"
                type="number"
                min={0}
                step={1 / 10 ** currencyDigits(currency)}
                placeholder={t.amountPlaceholder}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              {t.currency}
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {Intl.supportedValuesOf("currency").map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label>
              {t.probability}
              <input
                name="probability"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={deal?.probability ?? ""}
                placeholder={t.unspecified}
              />
            </label>
            <label>
              {t.expectedCloseDate}
              <input
                name="expectedCloseDate"
                type="date"
                defaultValue={deal?.expectedCloseDate ?? ""}
              />
            </label>
          </div>
          <label>
            {t.dealDescription}
            <textarea
              name="description"
              maxLength={10000}
              rows={3}
              defaultValue={deal?.description ?? ""}
            />
          </label>
          {stage?.kind === "lost" && (
            <label>
              {t.lostReason}
              <textarea
                name="lostReason"
                maxLength={2000}
                defaultValue={deal?.lostReason ?? ""}
              />
            </label>
          )}
        </fieldset>
        {loading && <p role="status">{t.loading}</p>}
        {(error || loadError) && <p role="alert">{error || loadError}</p>}
        {loadError && (
          <button type="button" onClick={retry}>
            {t.authRetry}
          </button>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || loading || !!loadError || !stage}
          >
            {busy ? t.saving : t.saveDeal}
            <ShortcutHint keys={t.keys.submit} />
          </button>
        </div>
      </form>
    </dialog>
  );
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
        onKeyDown={submitOnModEnter}
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
