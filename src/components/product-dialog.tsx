"use client";
import t from "@crm/i18n/translations/en.json";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { submitOnSaveKey, useModalLifecycle } from "./modal-lifecycle";
import { ShortcutHint } from "./ui/shortcut-hint";

export function ProductDialog({
  organizationId,
  organizationName,
  mutate,
  onClose,
}: {
  organizationId: string;
  organizationName: string;
  mutate: (body: object) => Promise<boolean>;
  onClose: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  useModalLifecycle(modal);
  return (
    <dialog
      ref={modal}
      className="dialog product-dialog"
      aria-labelledby="product-dialog-title"
      aria-describedby="product-dialog-detail"
      onCancel={(event) => {
        if (submitting.current) event.preventDefault();
        else onClose();
      }}
    >
      <span className="eyebrow">{organizationName}</span>
      <h2 id="product-dialog-title">{t.newProduct}</h2>
      <p className="muted" id="product-dialog-detail">
        {t.productCreationDetail}
      </p>
      <form
        onKeyDown={submitOnSaveKey}
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current) return;
          const form = event.currentTarget;
          const name = String(new FormData(form).get("name") ?? "").trim();
          if (!name) {
            form.querySelector<HTMLInputElement>("input")?.focus();
            return;
          }
          submitting.current = true;
          setBusy(true);
          try {
            if (await mutate({ operation: "product", organizationId, name }))
              onClose();
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          {t.productName}
          <input
            name="name"
            required
            maxLength={100}
            placeholder={t.productNamePlaceholder}
            disabled={busy}
            autoFocus
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {t.cancel} <ShortcutHint id="back" />
          </button>
          <button
            type="submit"
            className="primary"
            title={t.submitHint}
            aria-label={t.newProduct}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            disabled={busy}
          >
            <Plus size={14} aria-hidden />
            {busy ? t.saving : t.newProduct}
            <ShortcutHint id="save" />
          </button>
        </div>
      </form>
    </dialog>
  );
}
