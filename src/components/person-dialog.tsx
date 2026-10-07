"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useRef, useState } from "react";
import { errorText, requestJson } from "./client-api";
import { useDialogSnapshot } from "./dialog-snapshot";
import { submitOnSaveKey } from "./modal-lifecycle";
import { InlineRecordFrame } from "./records/inline-record-frame";
import { ShortcutHint } from "./ui/shortcut-hint";
import { LoadingState } from "./ui/states";

export function PersonDialog({
  data: initialData,
  organizationId,
  productId,
  onClose,
  onCreated,
}: {
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  onClose: () => void;
  onCreated: (result: {
    relationshipId: string;
    productId: string;
  }) => Promise<void>;
}) {
  const submitting = useRef(false);
  const {
    data,
    loading,
    error: loadError,
    retry,
  } = useDialogSnapshot(initialData, organizationId);
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <InlineRecordFrame
      titleId="person-dialog-title"
      loading={loading}
      busy={busy}
    >
      <h2 id="person-dialog-title">{t.addPerson}</h2>
      <div className="tabs">
        <button
          type="button"
          disabled={busy || loading || !!loadError}
          aria-pressed={!existing}
          onClick={() => {
            setExisting(false);
            setError("");
          }}
        >
          {t.newPerson}
        </button>
        <button
          type="button"
          disabled={busy || loading || !!loadError}
          aria-pressed={existing}
          onClick={() => {
            setExisting(true);
            setError("");
          }}
        >
          {t.existingPerson}
        </button>
      </div>
      <form
        onKeyDown={submitOnSaveKey}
        key={String(existing)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current || loading || loadError) return;
          submitting.current = true;
          const form = event.currentTarget;
          const fields = new FormData(form);
          setBusy(true);
          setError("");
          try {
            const result = await requestJson<{
              relationshipId: string;
              productId: string;
            }>("/api/crm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                operation: "person",
                organizationId,
                productId: fields.get("productId"),
                ...(existing
                  ? { personId: fields.get("personId") }
                  : {
                      name: fields.get("name"),
                      email: fields.get("email") || undefined,
                      title: fields.get("title") || "",
                      companyId: fields.get("companyId") || undefined,
                    }),
                purpose: fields.get("purpose"),
                context: fields.get("context") || "",
                review: fields.get("review") === "on",
                channel: fields.get("channel"),
              }),
            });
            form.closest("[data-record-editor]")?.removeAttribute("data-dirty");
            onClose();
            await onCreated(result);
          } catch (error) {
            setError(errorText(error));
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
            {t.product}
            <select
              name="productId"
              required
              defaultValue={productId || data.products[0]?.id}
            >
              {data.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          {existing ? (
            <>
              <label>
                {t.person}
                <select data-primary-field name="personId" required>
                  <option value="">{t.choosePerson}</option>
                  {data.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {person.email || person.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">{t.personLinkNote}</p>
            </>
          ) : (
            <>
              <label>
                {t.name}
                <input
                  data-primary-field
                  name="name"
                  required
                  maxLength={100}
                />
              </label>
              <label>
                {t.email}
                <input name="email" type="email" maxLength={254} />
              </label>
              <label>
                {t.roleTitle}
                <input name="title" maxLength={150} />
              </label>
              <label>
                {t.company}
                <select name="companyId">
                  <option value="">{t.noCompany}</option>
                  {data.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            {t.purpose}
            <select name="purpose">
              <option value="buyer">{t.buyer}</option>
              <option value="partner">{t.partner}</option>
            </select>
          </label>
          <label>
            {t.relationshipContext}
            <textarea name="context" maxLength={10000} rows={3} />
          </label>
          <label>
            {t.channel}
            <select name="channel">
              <option value="gmail">{t.gmail}</option>
              <option value="linkedin">{t.linkedin}</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input name="review" type="checkbox" defaultChecked />
            {t.addResearchAction}
          </label>
        </fieldset>
        <p className="muted">{t.personCreateNote}</p>
        {error || loadError ? (
          <p role="alert">{error || loadError}</p>
        ) : (
          loading && <LoadingState rows={2} />
        )}
        {loadError && (
          <button type="button" onClick={retry}>
            {t.retry}
          </button>
        )}
        <div className="dialog-actions">
          <button
            data-modal-cancel
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {t.cancel} <ShortcutHint id="back" />
          </button>
          <button
            type="submit"
            aria-label={busy ? t.saving : t.create}
            title={t.submitHint}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="primary"
            disabled={busy || loading || !!loadError || !data.products.length}
          >
            {busy ? t.saving : t.create}
            <ShortcutHint id="save" />
          </button>
        </div>
      </form>
    </InlineRecordFrame>
  );
}
