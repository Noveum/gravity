"use client";
import type { ConnectionOverview } from "@crm/connectors/service";
import type { IntegrationProvider } from "@crm/connectors/types";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import {
  CalendarDays,
  Check,
  Copy,
  Mail,
  MessageSquare,
  Mic,
  Plug,
  RefreshCw,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { dateLabel, errorText, requestJson } from "./client-api";
import {
  submitOnModEnter,
  useModalLifecycle,
  useReadyFocus,
} from "./modal-lifecycle";

const providers = ["gmail", "calendar", "linkedin", "fireflies"] as const;
const icons = {
  gmail: Mail,
  calendar: CalendarDays,
  linkedin: MessageSquare,
  fireflies: Mic,
};
export function IntegrationCards({
  data,
  organizationId,
  productId,
  demo,
  initialNotice,
  onChanged,
}: {
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  demo: boolean;
  initialNotice: string;
  onChanged: () => Promise<void>;
}) {
  const [overview, setOverview] = useState<ConnectionOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const [modal, setModal] = useState<IntegrationProvider | null>(null);
  const [existing, setExisting] = useState<string | undefined>();
  const pending = useRef(false);
  const alive = useRef(true);
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    if (demo) return;
    const generation = ++loadGeneration.current;
    try {
      const result = await requestJson<ConnectionOverview>(
        `/api/integrations?organizationId=${organizationId}${productId ? `&productId=${productId}` : ""}`,
      );
      if (alive.current && generation === loadGeneration.current) {
        setOverview(result);
        setError("");
      }
    } catch (cause) {
      if (alive.current && generation === loadGeneration.current)
        setError(errorText(cause));
    } finally {
      if (alive.current && generation === loadGeneration.current)
        setLoading(false);
    }
  }, [organizationId, productId, demo]);
  useEffect(() => {
    alive.current = true;
    void load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      alive.current = false;
      loadGeneration.current++;
      clearInterval(poll);
    };
  }, [load]);
  const priorRevision = useRef(data.asOf);
  useEffect(() => {
    if (priorRevision.current !== data.asOf) {
      priorRevision.current = data.asOf;
      void load();
    }
  }, [data.asOf, load]);
  async function mutate(operation: string, body: object, key: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(key);
    setError("");
    try {
      const result = await requestJson<{ imported?: number; more?: boolean }>(
        "/api/integrations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation, organizationId, ...body }),
        },
      );
      if (alive.current) {
        setNotice(
          operation === "sync"
            ? result.more
              ? "SYNC_MORE"
              : "SYNC_COMPLETE"
            : operation === "disconnect"
              ? "CONNECTION_DISCONNECTED"
              : "IMPORT_REVIEWED",
        );
        await load();
        await onChanged();
      }
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy("");
    }
  }
  return (
    <>
      <div className="integration-intro">
        <p>{t.integrationIntro}</p>
        {loading && <span role="status">{t.loading}</span>}
        {error && (
          <p role="alert">
            {error}
            <button type="button" onClick={() => void load()}>
              {t.retry}
            </button>
          </p>
        )}
        {notice && (
          <p role="status">
            {t.integrationMessages[
              notice as keyof typeof t.integrationMessages
            ] ??
              t.errors[notice as keyof typeof t.errors] ??
              ""}
          </p>
        )}
      </div>
      {providers.map((provider) => {
        const Icon = icons[provider];
        const rows =
          overview?.connections.filter((c) => c.provider === provider) ?? [];
        const configured = overview?.configured[provider] ?? false;
        return (
          <article key={provider} className="integration-card">
            <div className="section-heading">
              <h2>
                <Icon size={18} aria-hidden="true" />
                {t[provider]}
              </h2>
              <span className="badge">
                {rows.some((row) => row.status === "connected")
                  ? t.connected
                  : t.notConnected}
              </span>
            </div>
            <p>{t.integrationDescriptions[provider]}</p>
            {rows.map((row) => (
              <div className="connection-account" key={row.id}>
                <div>
                  <strong>{row.displayName}</strong>
                  <small className="connection-meta">
                    {data.products.find((p) => p.id === row.productId)?.name} ·{" "}
                    {row.status === "connected"
                      ? t.connected
                      : t.reconnectRequired}
                  </small>
                  <small className="connection-meta">
                    {row.lastSyncedAt
                      ? t.lastSynced.replace(
                          "{time}",
                          dateLabel(row.lastSyncedAt),
                        )
                      : t.notSynced}
                  </small>
                  {row.errorCode && (
                    <p role="alert">
                      {t.errors[row.errorCode as keyof typeof t.errors] ??
                        t.errors.PROVIDER_UNAVAILABLE}
                    </p>
                  )}
                  {row.more && (
                    <small className="connection-meta">{t.moreHistory}</small>
                  )}
                </div>
                <div className="connection-buttons">
                  <button
                    type="button"
                    disabled={!!busy || row.status !== "connected"}
                    onClick={() =>
                      void mutate("sync", { connectionId: row.id }, row.id)
                    }
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    {busy === row.id ? t.syncing : t.syncNow}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy || !configured}
                    onClick={() => {
                      setExisting(row.id);
                      setModal(provider);
                    }}
                  >
                    <Plug size={14} aria-hidden="true" />
                    {t.reconnect}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy || row.status === "disconnected"}
                    onClick={() =>
                      void mutate(
                        "disconnect",
                        { connectionId: row.id },
                        row.id,
                      )
                    }
                  >
                    <Unplug size={14} aria-hidden="true" />
                    {t.disconnect}
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="primary"
              disabled={
                demo ||
                loading ||
                !configured ||
                !!busy ||
                !data.products.length
              }
              onClick={() => {
                setExisting(undefined);
                setModal(provider);
              }}
            >
              <Plug size={15} aria-hidden="true" />
              {t.connectProvider.replace("{provider}", t[provider])}
            </button>
            {demo ? (
              <p className="connection-note">{t.integrationDemo}</p>
            ) : !loading && !configured ? (
              <p className="connection-note">
                {provider === "linkedin"
                  ? t.unipileSetupRequired
                  : t.integrationConfigRequired}
              </p>
            ) : null}
            {provider === "gmail" && (
              <p className="connection-note">{t.mailboxSeparateLogin}</p>
            )}
            {provider === "linkedin" && (
              <details className="connection-guide">
                <summary>{t.connectionSetup}</summary>
                <p>{t.linkedInSetup}</p>
                <a
                  href="https://developer.unipile.com/v2.0/docs/configure-a-webhook"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.webhookSetupGuide}
                </a>
              </details>
            )}
          </article>
        );
      })}
      {!!overview?.items.length && (
        <article className="integration-card import-review">
          <div className="section-heading">
            <h2>
              <Check size={18} aria-hidden="true" />
              {t.importReview}
            </h2>
            <span className="badge">{overview.items.length}</span>
          </div>
          <p>{t.importReviewDescription}</p>
          {overview.items.map((item) => (
            <form
              className="import-row"
              key={item.id}
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                void mutate(
                  "link",
                  {
                    itemId: item.id,
                    relationshipId: values.get("relationshipId"),
                  },
                  item.id,
                );
              }}
            >
              <div>
                <strong>{item.record.title}</strong>
                <small className="connection-meta">
                  {dateLabel(item.record.occurredAt)} ·{" "}
                  {item.record.participants.join(", ")}
                </small>
                <details>
                  <summary>{t.previewImport}</summary>
                  <p className="import-preview">
                    {item.record.body || t.noMessageText}
                  </p>
                  {item.record.proposedCommitment && (
                    <p className="import-preview">
                      {item.record.proposedCommitment}
                    </p>
                  )}
                </details>
              </div>
              <label className="sr-only" htmlFor={`match-${item.id}`}>
                {t.linkRelationship}
              </label>
              <select
                className="import-match"
                id={`match-${item.id}`}
                name="relationshipId"
                required
                disabled={!!busy}
                defaultValue=""
              >
                <option value="" disabled>
                  {t.chooseRelationship}
                </option>
                {data.relationships.map((relationship) => (
                  <option key={relationship.id} value={relationship.id}>
                    {
                      data.people.find((p) => p.id === relationship.personId)
                        ?.name
                    }{" "}
                    ·{" "}
                    {
                      data.products.find((p) => p.id === relationship.productId)
                        ?.name
                    }
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!!busy || !data.relationships.length}
              >
                {busy === item.id ? t.saving : t.linkImport}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void mutate("ignore", { itemId: item.id }, item.id)
                }
              >
                {t.ignoreImport}
              </button>
            </form>
          ))}
        </article>
      )}
      {modal && (
        <ConnectDialog
          provider={modal}
          data={data}
          organizationId={organizationId}
          productId={
            overview?.connections.find((row) => row.id === existing)
              ?.productId ?? productId
          }
          connectionId={existing}
          onClose={() => {
            setModal(null);
            void load();
          }}
          onConnected={async () => {
            await load();
            await onChanged();
          }}
        />
      )}
    </>
  );
}
function ConnectDialog({
  provider,
  data,
  organizationId,
  productId,
  connectionId,
  onClose,
  onConnected,
}: {
  provider: IntegrationProvider;
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  connectionId?: string;
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [webhook, setWebhook] = useState<{
    webhookUrl: string;
    signingSecret: string;
  } | null>(null);
  const [copied, setCopied] = useState("");
  useModalLifecycle(ref);
  useReadyFocus(ref, false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="connect-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <h2 id="connect-title">
        {t.connectProvider.replace("{provider}", t[provider])}
      </h2>
      {webhook ? (
        <>
          <p>{t.firefliesWebhookInstructions}</p>
          {(
            [
              ["webhookUrl", t.webhookUrl],
              ["signingSecret", t.signingSecret],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label}
              <div className="endpoint-copy">
                <input
                  readOnly
                  type={field === "signingSecret" ? "password" : "text"}
                  value={webhook[field]}
                />
                <button
                  type="button"
                  aria-label={t.copyValue.replace("{label}", label)}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(webhook[field]);
                      setCopied(label);
                    } catch {
                      setError(t.copyFailed);
                    }
                  }}
                >
                  {copied === label ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </label>
          ))}
          <p>{t.firefliesWebhookEvents}</p>
          <button type="button" className="primary" onClick={onClose}>
            {t.done}
          </button>
        </>
      ) : (
        <form
          onKeyDown={submitOnModEnter}
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            setError("");
            const selected = connectionId
              ? productId
              : new FormData(event.currentTarget).get("productId");
            try {
              const result = await requestJson<{
                url?: string;
                webhookUrl?: string;
                signingSecret?: string;
              }>("/api/integrations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operation: "connect",
                  organizationId,
                  productId: selected,
                  provider,
                  connectionId,
                  ...(provider === "fireflies" ? { apiKey: key } : {}),
                }),
              });
              if (!alive.current) return;
              setKey("");
              if (result.url) {
                const target = new URL(result.url);
                if (
                  target.protocol !== "https:" ||
                  !["accounts.google.com", "auth.unipile.com"].includes(
                    target.hostname,
                  )
                )
                  throw new Error("PROVIDER_RESPONSE_INVALID");
                window.location.assign(target.href);
              } else {
                await onConnected();
                if (result.webhookUrl && result.signingSecret)
                  setWebhook({
                    webhookUrl: result.webhookUrl,
                    signingSecret: result.signingSecret,
                  });
                else onClose();
              }
            } catch (cause) {
              if (alive.current) setError(errorText(cause));
            } finally {
              pending.current = false;
              if (alive.current) setBusy(false);
            }
          }}
        >
          <p>
            {provider === "fireflies"
              ? t.firefliesConnectNote
              : provider === "linkedin"
                ? t.linkedinConnectNote
                : t.googleConnectNote}
          </p>
          <label>
            {t.defaultProduct}
            <select
              name="productId"
              required
              defaultValue={productId || data.products[0]?.id || ""}
              disabled={busy || !!connectionId}
              data-primary-field
            >
              {data.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">{t.defaultProductNote}</p>
          {provider === "fireflies" && (
            <label>
              {t.firefliesApiKey}
              <input
                type="password"
                autoComplete="off"
                required
                minLength={10}
                maxLength={2000}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                disabled={busy}
                placeholder={t.firefliesKeyPlaceholder}
              />
            </label>
          )}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              <X size={14} aria-hidden="true" />
              {t.cancel}
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy
                ? t.connecting
                : provider === "fireflies"
                  ? t.verifyConnect
                  : t.continueProvider.replace(
                      "{provider}",
                      provider === "linkedin" ? t.unipile : t.google,
                    )}
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
