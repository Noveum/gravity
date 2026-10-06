"use client";
import t from "@crm/i18n/translations/en.json";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { errorText, requestJson } from "../client-api";
import type { SettingsSection } from "../routes";
import { ErrorState, LoadingState } from "../ui/states";

export function SettingsPanel({
  section,
  actions,
  children,
}: {
  section: SettingsSection;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-panel" aria-labelledby={`settings-${section}`}>
      <header className="settings-panel-header">
        <div>
          <h2 id={`settings-${section}`}>{t.settingsSections[section]}</h2>
          <p className="muted settings-panel-description">
            {t.settingsDescriptions[section]}
          </p>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function SettingsGroup({
  title,
  detail,
  actions,
  children,
}: {
  title: string;
  detail?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className="settings-group" aria-labelledby={id}>
      <div className="settings-group-title">
        <h3 id={id}>{title}</h3>
        {actions}
      </div>
      {detail && <p className="settings-note">{detail}</p>}
      {children}
    </fieldset>
  );
}

export function AdminNotice() {
  return <p className="settings-note">{t.adminOnly}</p>;
}

export function useSettingsQuery<T>(url: string | null, revision?: unknown) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!url);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await requestJson<T>(url);
      if (current !== generation.current) return;
      setData(result);
      setError("");
    } catch (cause) {
      if (current === generation.current) setError(errorText(cause));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void revision;
    void load();
    return () => {
      generation.current++;
    };
  }, [load, revision]);
  return { data, error, loading: loading && !data, reload: load };
}

export function QueryState({
  error,
  loading,
  onRetry,
  rows = 3,
}: {
  error: string;
  loading: boolean;
  onRetry: () => void;
  rows?: number;
}) {
  if (error)
    return (
      <ErrorState
        title={t.settingsLoadError}
        description={error}
        onRetry={onRetry}
      />
    );
  return loading ? <LoadingState rows={rows} /> : null;
}

export function ConfirmButton({
  label,
  confirmLabel,
  disabled = false,
  onConfirm,
  children,
}: {
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => Promise<unknown>;
  children?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        className="ghost"
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  return (
    <span className="settings-confirm">
      {children}
      <button
        type="button"
        className="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? t.saving : confirmLabel}
      </button>
      <button type="button" disabled={busy} onClick={() => setAsking(false)}>
        {t.cancel}
      </button>
    </span>
  );
}
