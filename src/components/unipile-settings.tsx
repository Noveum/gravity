"use client";
import type { ConnectionOverview } from "@crm/connectors/service";
import t from "@crm/i18n/translations/en.json";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, requestJson } from "./client-api";
import {
  submitOnModEnter,
  useModalLifecycle,
  useReadyFocus,
} from "./modal-lifecycle";

export function UnipileSettings({
  organizationId,
  configuration,
  onClose,
  onChanged,
}: {
  organizationId: string;
  configuration: ConnectionOverview["unipileConfiguration"];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const [saved, setSaved] = useState(configuration);
  const [apiKey, setApiKey] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useModalLifecycle(ref);
  useReadyFocus(ref, busy);
  useEffect(() => {
    if (!busy)
      ref.current
        ?.querySelector<HTMLElement>(
          "[data-primary-field], .dialog-actions .primary:not(:disabled)",
        )
        ?.focus();
  }, [busy]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function submit(remove = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<
        NonNullable<ConnectionOverview["unipileConfiguration"]>
      >("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: remove ? "remove-unipile" : "configure-unipile",
          organizationId,
          configurationId: saved?.id,
          ...(!remove ? (saved ? { signingSecret } : { apiKey }) : {}),
        }),
      });
      if (!alive.current) return;
      setApiKey("");
      setSigningSecret("");
      setSaved(remove ? null : result);
      await onChanged();
      if (remove && alive.current) onClose();
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="dialog provider-settings"
      aria-labelledby="unipile-settings-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="provider-settings-heading">
        <div className="provider-icon">
          <KeyRound size={22} aria-hidden="true" />
        </div>
        <div>
          <h2 id="unipile-settings-title">{t.unipileSettingsTitle}</h2>
          <p className="muted">{t.unipileSettingsSubtitle}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t.close}
          title={t.close}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="provider-privacy">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>{t.unipileOwnership}</p>
      </div>
      <ol className="provider-steps" aria-label={t.unipileSetupSteps}>
        <li className={saved ? "completed" : "current"}>
          <span>{saved ? <Check size={14} aria-hidden="true" /> : "1"}</span>
          {t.unipileApiStep}
        </li>
        <li
          className={saved?.webhookReady ? "completed" : saved ? "current" : ""}
        >
          <span>
            {saved?.webhookReady ? <Check size={14} aria-hidden="true" /> : "2"}
          </span>
          {t.unipileWebhookStep}
        </li>
      </ol>
      {saved && (
        <label>
          {t.webhookUrl}
          <div className="endpoint-copy">
            <input readOnly value={saved.webhookUrl} />
            <button
              type="button"
              aria-label={t.copyValue.replace("{label}", t.webhookUrl)}
              title={t.copyValue.replace("{label}", t.webhookUrl)}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(saved.webhookUrl);
                  if (alive.current) setCopied(true);
                } catch {
                  if (alive.current) setError(t.copyFailed);
                }
              }}
            >
              {copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {copied ? t.copied : t.copy}
            </button>
          </div>
        </label>
      )}
      {saved?.webhookReady ? (
        <p className="provider-ready" role="status">
          <ShieldCheck size={18} aria-hidden="true" />
          {t.unipileReady}
        </p>
      ) : (
        <form
          onKeyDown={submitOnModEnter}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {saved ? (
            <>
              <p>{t.unipileWebhookInstructions}</p>
              <p className="muted">{t.unipileWebhookEvents}</p>
              <label>
                {t.signingSecret}
                <input
                  data-primary-field
                  type="password"
                  autoComplete="off"
                  required
                  minLength={16}
                  maxLength={2000}
                  placeholder={t.unipileSecretPlaceholder}
                  value={signingSecret}
                  disabled={busy}
                  onChange={(event) => setSigningSecret(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <p>{t.unipileKeyInstructions}</p>
              <label>
                {t.unipileApiKey}
                <input
                  data-primary-field
                  type="password"
                  autoComplete="off"
                  required
                  minLength={10}
                  maxLength={2000}
                  placeholder={t.unipileKeyPlaceholder}
                  value={apiKey}
                  disabled={busy}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <p className="muted">{t.unipileScopedKeyNote}</p>
            </>
          )}
          <a
            className="provider-docs-link"
            href={
              saved
                ? "https://developer.unipile.com/v2.0/docs/configure-a-webhook"
                : "https://developer.unipile.com/v2.0/docs/scopes"
            }
            target="_blank"
            rel="noreferrer"
          >
            {saved ? t.webhookSetupGuide : t.unipileKeyGuide}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              <X size={14} aria-hidden="true" />
              {t.cancel}
            </button>
            <button type="submit" className="primary" disabled={busy}>
              <ArrowRight size={15} aria-hidden="true" />
              {busy
                ? t.saving
                : saved
                  ? t.unipileSaveWebhook
                  : t.unipileVerifyKey}
            </button>
          </div>
        </form>
      )}
      {saved && (
        <div className="provider-remove">
          {confirmRemove ? (
            <>
              <p>{t.unipileRemoveWarning}</p>
              <div className="dialog-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmRemove(false)}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => void submit(true)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {busy ? t.saving : t.unipileConfirmRemove}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="danger-link"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
              {t.unipileRemove}
            </button>
          )}
        </div>
      )}
      {saved?.webhookReady && !confirmRemove && (
        <div className="dialog-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={onClose}
          >
            <Check size={15} aria-hidden="true" />
            {t.done}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
