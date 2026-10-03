"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
import { errorText, requestJson } from "./crm-app";

export function PersonDialog({
  data,
  organizationId,
  productId,
  onClose,
  onCreated,
}: {
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  onClose: () => void;
  onCreated: (relationshipId: string) => Promise<void>;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    modal.current?.showModal();
  }, []);
  return (
    <dialog
      ref={modal}
      className="dialog"
      aria-labelledby="person-dialog-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <h2 id="person-dialog-title">{t.addPerson}</h2>
      <div className="tabs">
        <button
          type="button"
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
        key={String(existing)}
        onSubmit={async (event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          try {
            const result = await requestJson<{ relationshipId: string }>(
              "/api/crm",
              {
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
              },
            );
            await onCreated(result.relationshipId);
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
              <select name="personId" required>
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
              <input name="name" required maxLength={100} />
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
        <p className="muted">{t.personCreateNote}</p>
        <p role="status">{error}</p>
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t.cancel}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !data.products.length}
          >
            {busy ? t.saving : t.create}
          </button>
        </div>
      </form>
    </dialog>
  );
}
