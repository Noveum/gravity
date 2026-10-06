"use client";
import t from "@crm/i18n/translations/en.json";
import { type ReactNode, useId, useRef, useState } from "react";
import { errorText } from "../client-api";
import {
  submitOnSaveKey,
  useModalLifecycle,
  useReadyFocus,
} from "../modal-lifecycle";

export function RecordDialog({
  title,
  submitLabel,
  onClose,
  onSubmit,
  children,
  loading = false,
  className = "",
}: {
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (fields: FormData) => Promise<string | null>;
  children: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useModalLifecycle(modal);
  useReadyFocus(modal, loading);
  return (
    <dialog
      ref={modal}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <form
        onKeyDown={submitOnSaveKey}
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current || loading) return;
          submitting.current = true;
          const fields = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          try {
            const failure = await onSubmit(fields);
            if (failure === null) onClose();
            else setError(failure);
          } catch (cause) {
            setError(errorText(cause));
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset className="dialog-fields" disabled={busy || loading}>
          {children}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            data-modal-cancel
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            title={t.submitHint}
            className="primary"
            disabled={busy || loading}
          >
            {busy ? t.saving : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export const text = (fields: FormData, name: string) =>
  String(fields.get(name) ?? "").trim();
