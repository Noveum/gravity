"use client";
import t from "@crm/i18n/translations/en.json";
import { type ChangeEvent, useId, useRef, useState } from "react";
import { errorText } from "../client-api";

export function InlineField<T extends { version: number }>({
  label,
  record,
  value,
  onSave,
  multiline = false,
  type = "text",
  maxLength = 10000,
  required = false,
  readOnly = false,
  options,
}: {
  label: string;
  record: T;
  value: string;
  onSave: (value: string, original: T) => Promise<string | null>;
  multiline?: boolean;
  type?: "text" | "email" | "tel" | "url" | "date" | "number";
  maxLength?: number;
  required?: boolean;
  readOnly?: boolean;
  options?: { value: string; label: string }[];
}) {
  const id = useId();
  const [draft, setDraft] = useState<{ value: string; original: T } | null>(
    null,
  );
  const [accepted, setAccepted] = useState<{
    value: string;
    version: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const current =
    accepted && record.version < accepted.version ? accepted.value : value;
  const dirty = draft !== null;
  const change = (
    event: ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    setDraft((previous) => ({
      value: event.target.value,
      original: previous?.original ?? record,
    }));
    setError("");
    setSaved(false);
  };
  const cancel = () => {
    if (submitting.current) return;
    setDraft(null);
    setError("");
  };
  const control = {
    id,
    value: draft?.value ?? current,
    onChange: change,
    disabled: busy || readOnly,
    required,
    "aria-describedby": error ? `${id}-error` : undefined,
    "aria-invalid": error ? (true as const) : undefined,
    placeholder: t.inlineEditing.empty,
    "data-inline-field": "",
  };
  return (
    <form
      className="inline-field"
      data-dirty={dirty || undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          event.currentTarget
            .querySelector<HTMLElement>("[data-inline-field]")
            ?.blur();
        } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.requestSubmit();
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!draft || submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
          const failure = await onSave(draft.value, draft.original);
          if (failure) setError(failure);
          else {
            setAccepted({
              value: draft.value,
              version: draft.original.version + 1,
            });
            setDraft(null);
            setSaved(true);
          }
        } catch (cause) {
          setError(errorText(cause));
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      {options ? (
        <select {...control}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          {...control}
          rows={Math.min(
            8,
            Math.max(3, (draft?.value ?? current).split("\n").length),
          )}
          maxLength={maxLength}
        />
      ) : (
        <input
          {...control}
          type={type}
          maxLength={maxLength}
          step={type === "number" ? "any" : undefined}
        />
      )}
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {dirty && (
        <div className="inline-field-actions">
          <span className="muted">{t.inlineEditing.unsaved}</span>
          <button
            type="button"
            className="small ghost"
            disabled={busy}
            onClick={cancel}
          >
            {t.cancel}
          </button>
          <button type="submit" className="small primary" disabled={busy}>
            {busy ? t.saving : t.save}
          </button>
        </div>
      )}
      {saved && !dirty && (
        <span role="status" className="inline-saved">
          {t.inlineEditing.saved}
        </span>
      )}
    </form>
  );
}
