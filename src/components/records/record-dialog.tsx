"use client";
import t from "@crm/i18n/translations/en.json";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { errorText } from "../client-api";
import {
  submitOnSaveKey,
  useModalLifecycle,
  useReadyFocus,
} from "../modal-lifecycle";

export const RecordEditorMode = createContext(false);

export function RecordDialog({
  title,
  submitLabel,
  onClose,
  onSubmit,
  children,
  loading = false,
  className = "",
  inline = false,
  dirty = false,
}: {
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (fields: FormData) => Promise<string | null>;
  children: ReactNode;
  loading?: boolean;
  className?: string;
  inline?: boolean;
  dirty?: boolean;
}) {
  const embedded = useContext(RecordEditorMode) || inline;
  const modal = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useModalLifecycle(modal, !embedded);
  useReadyFocus(modal, loading);
  useEffect(() => {
    if (embedded && !loading)
      editor.current
        ?.querySelector<HTMLElement>("[data-primary-field]")
        ?.focus();
  }, [embedded, loading]);
  const [changed, setChanged] = useState(false);
  const content = (
    <>
      <h2 id={titleId}>{title}</h2>
      <form
        data-dirty={dirty || changed || busy || undefined}
        onChange={() => setChanged(true)}
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
    </>
  );
  return embedded ? (
    <section
      ref={editor}
      data-record-editor
      className={`inline-record-editor ${className}`}
      aria-labelledby={titleId}
    >
      {content}
    </section>
  ) : (
    <dialog
      ref={modal}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      {content}
    </dialog>
  );
}

export const text = (fields: FormData, name: string) =>
  String(fields.get(name) ?? "").trim();
