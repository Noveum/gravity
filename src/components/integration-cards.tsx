"use client";
import type { ConnectionOverview } from "@crm/connectors/service";
import type { IntegrationProvider } from "@crm/connectors/types";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  KeyRound,
  Mail,
  MessageSquare,
  Mic,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { dateLabel, errorText, requestJson } from "./client-api";
import {
  submitOnSaveKey,
  useModalLifecycle,
  useReadyFocus,
} from "./modal-lifecycle";
import { UnipileSettings } from "./unipile-settings";

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
  timeZone = "UTC",
}: {
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  demo: boolean;
  initialNotice: string;
  onChanged: () => Promise<void>;
  timeZone?: string;
}) {
  const [overview, setOverview] = useState<ConnectionOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const [modal, setModal] = useState<IntegrationProvider | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [existing, setExisting] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewProvider, setReviewProvider] = useState<
    IntegrationProvider | ""
  >("");
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const reviewCursor = pages.at(-1);
  const pending = useRef(false);
  const alive = useRef(true);
  const loadGeneration = useRef(0);
  useEffect(() => {
    if (search.trim() === reviewQuery) return;
    const timer = window.setTimeout(() => {
      setReviewQuery(search.trim());
      setPages([undefined]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, reviewQuery]);
  const load = useCallback(async () => {
    if (demo) return;
    const generation = ++loadGeneration.current;
    try {
      const query = new URLSearchParams({ organizationId });
      if (productId) query.set("productId", productId);
      if (reviewQuery) query.set("reviewQuery", reviewQuery);
      if (reviewProvider) query.set("reviewProvider", reviewProvider);
      if (reviewCursor) query.set("reviewCursor", reviewCursor);
      const result = await requestJson<ConnectionOverview>(
        `/api/integrations?${query}`,
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
  }, [
    organizationId,
    productId,
    demo,
    reviewQuery,
    reviewProvider,
    reviewCursor,
  ]);
  const currentLoad = useRef(load);
  currentLoad.current = load;
  useEffect(() => {
    alive.current = true;
    setLoading(!demo);
    setOverview((prior) =>
      prior ? { ...prior, items: [], nextReviewCursor: null } : null,
    );
    void load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      alive.current = false;
      loadGeneration.current++;
      clearInterval(poll);
    };
  }, [load, demo]);
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
        await currentLoad.current();
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
        <h2>{t.myProviderAccounts}</h2>
        <p>{t.accountPrivacyNote}</p>
        <p>{t.integrationIntro}</p>
        <p>{t.integrationTimeZone.replace("{zone}", timeZone)}</p>
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
          <article
            key={provider}
            className="integration-card"
            aria-label={t[provider]}
          >
            <div className="section-heading">
              <h2>
                <Icon size={18} aria-hidden="true" />
                {t[provider]}
              </h2>
              <span className="badge">
                {rows.length > 1
                  ? t.connectedAccountCount.replace(
                      "{count}",
                      String(rows.length),
                    )
                  : rows.some((row) => row.status === "connected")
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
                      : row.status === "disconnected"
                        ? t.disconnected
                        : t.reconnectRequired}
                  </small>
                  <small className="connection-meta">
                    {row.lastSyncedAt
                      ? t.lastSynced.replace(
                          "{time}",
                          dateLabel(row.lastSyncedAt, timeZone),
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
                    disabled={
                      !!busy ||
                      !configured ||
                      (provider === "linkedin" &&
                        row.providerConfigurationId !==
                          overview?.unipileConfiguration?.id)
                    }
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
            <div className="integration-card-actions">
              {provider === "linkedin" && !configured ? (
                <button
                  type="button"
                  className="primary"
                  disabled={demo || loading || !!busy}
                  onClick={() => setSettingsOpen(true)}
                >
                  <KeyRound size={15} aria-hidden="true" />
                  {t.unipileSetUp}
                </button>
              ) : (
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
                  <Plus size={15} aria-hidden="true" />
                  {(rows.length
                    ? t.addProviderAccount
                    : t.connectProvider
                  ).replace("{provider}", t[provider])}
                </button>
              )}
              {provider === "linkedin" && configured && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2 size={15} aria-hidden="true" />
                  {t.unipileManage}
                </button>
              )}
            </div>
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
            {provider === "gmail" &&
              rows.some(
                (row) => row.status === "connected" && row.canSend === false,
              ) && <p className="connection-note">{t.mailboxSendUpgrade}</p>}
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
      {!!overview?.connections.length && (
        <article className="integration-card import-review">
          <div className="section-heading">
            <h2>
              <Check size={18} aria-hidden="true" />
              {t.importReview}
            </h2>
            <span className="badge">{overview.reviewTotal}</span>
          </div>
          <p>{t.importReviewDescription}</p>
          <div className="import-review-toolbar">
            <label className="import-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">{t.searchImports}</span>
              <input
                className="import-search-input"
                type="search"
                value={search}
                maxLength={120}
                placeholder={t.searchImports}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="sr-only" htmlFor="import-provider">
              {t.importProvider}
            </label>
            <select
              id="import-provider"
              value={reviewProvider}
              disabled={!!busy}
              onChange={(event) => {
                setReviewProvider(
                  event.target.value as IntegrationProvider | "",
                );
                setPages([undefined]);
              }}
            >
              <option value="">{t.allImportProviders}</option>
              {providers.map((provider) => (
                <option value={provider} key={provider}>
                  {t[provider]}
                </option>
              ))}
            </select>
          </div>
          <div aria-busy={loading}>
            {!loading && !overview.items.length && (
              <p role="status">{t.noImportsFound}</p>
            )}
            {loading && <p role="status">{t.loading}</p>}
            {!loading &&
              overview.items.map((item) => (
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
                      {dateLabel(item.record.occurredAt, timeZone)} ·{" "}
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
                          data.people.find(
                            (p) => p.id === relationship.personId,
                          )?.name
                        }{" "}
                        ·{" "}
                        {
                          data.products.find(
                            (p) => p.id === relationship.productId,
                          )?.name
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
          </div>
          <div className="import-pagination">
            <span role="status" className="import-page-status">
              {t.importPage
                .replace("{page}", String(pages.length))
                .replace("{total}", String(overview.reviewTotal))}
            </span>
            <div className="connection-buttons">
              <button
                type="button"
                disabled={loading || !!busy || pages.length === 1}
                onClick={() => setPages((prior) => prior.slice(0, -1))}
              >
                <ChevronLeft size={15} aria-hidden="true" />
                {t.previousImports}
              </button>
              <button
                type="button"
                disabled={loading || !!busy || !overview.nextReviewCursor}
                onClick={() =>
                  setPages((prior) => [
                    ...prior,
                    overview.nextReviewCursor ?? undefined,
                  ])
                }
              >
                {t.nextImports}
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </article>
      )}
      {settingsOpen && (
        <UnipileSettings
          organizationId={organizationId}
          configuration={overview?.unipileConfiguration ?? null}
          onClose={() => setSettingsOpen(false)}
          onContinue={() => {
            setSettingsOpen(false);
            setExisting(undefined);
            setModal("linkedin");
          }}
          onChanged={async () => {
            await currentLoad.current();
            await onChanged();
          }}
        />
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
          unipileVersion={overview?.unipileConfiguration?.apiVersion}
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
  unipileVersion,
  onClose,
  onConnected,
}: {
  provider: IntegrationProvider;
  data: ClientSnapshot;
  organizationId: string;
  productId: string;
  connectionId?: string;
  unipileVersion?: "v1" | "v2";
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [allowSending, setAllowSending] = useState(true);
  const [completedConnectionId, setCompletedConnectionId] = useState<string>();
  const [completedProductId, setCompletedProductId] = useState<string>();
  const v1 = provider === "linkedin" && unipileVersion === "v1";
  const [accounts, setAccounts] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const [accountCursor, setAccountCursor] = useState<string | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(v1);
  const [accountAttempt, setAccountAttempt] = useState(0);
  const [webhook, setWebhook] = useState<{
    webhookUrl: string;
    signingSecret: string;
  } | null>(null);
  const [copied, setCopied] = useState("");
  useModalLifecycle(ref);
  useReadyFocus(ref, false);
  useEffect(() => {
    if (!v1 || connectionId) return;
    let cancelled = false;
    setLoadingAccounts(true);
    if (accountAttempt > 0) setError("");
    const query = new URLSearchParams({
      operation: "unipile-accounts",
      organizationId,
    });
    void requestJson<{
      accounts: { id: string; name: string; status: string }[];
      nextCursor: string | null;
    }>(`/api/integrations?${query}`)
      .then((result) => {
        if (!cancelled) {
          setAccounts(result.accounts);
          setAccountCursor(result.nextCursor);
          setError("");
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(errorText(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [v1, connectionId, organizationId, accountAttempt]);
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
          onKeyDown={submitOnSaveKey}
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            setError("");
            const selected =
              completedProductId ??
              (connectionId
                ? productId
                : new FormData(event.currentTarget).get("productId"));
            try {
              const result = await requestJson<{
                url?: string;
                webhookUrl?: string;
                signingSecret?: string;
                connectionId?: string;
              }>("/api/integrations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operation: "connect",
                  organizationId,
                  productId: selected,
                  provider,
                  connectionId: completedConnectionId ?? connectionId,
                  ...(provider === "gmail" ? { allowSending } : {}),
                  ...(provider === "fireflies" ? { apiKey: key } : {}),
                  ...(v1 && !connectionId && !completedConnectionId
                    ? {
                        accountId: new FormData(event.currentTarget).get(
                          "accountId",
                        ),
                      }
                    : {}),
                }),
              });
              if (!alive.current) return;
              setKey("");
              if (v1 && result.connectionId) {
                setCompletedConnectionId(result.connectionId);
                if (typeof selected === "string")
                  setCompletedProductId(selected);
                await requestJson("/api/integrations", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    operation: "register-unipile-webhooks",
                    organizationId,
                    connectionId: result.connectionId,
                  }),
                });
              }
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
                ? v1
                  ? t.unipileV1ConnectNote
                  : t.linkedinConnectNote
                : t.googleConnectNote}
          </p>
          {v1 && !connectionId && (
            <>
              {loadingAccounts ? (
                <p role="status">{t.unipileLoadingAccounts}</p>
              ) : (
                <label>
                  {t.unipileAccount}
                  <select
                    name="accountId"
                    required
                    disabled={busy || !!completedConnectionId}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      {t.unipileAccountPlaceholder}
                    </option>
                    {accounts.map((account) => (
                      <option
                        key={account.id}
                        value={account.id}
                        disabled={account.status !== "OK"}
                      >
                        {account.name} ({account.status})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!loadingAccounts && error && !completedConnectionId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAccountAttempt((value) => value + 1)}
                >
                  {t.unipileRetryAccounts}
                </button>
              )}
              {accountCursor && !completedConnectionId && (
                <button
                  type="button"
                  disabled={busy || loadingAccounts}
                  onClick={async () => {
                    setLoadingAccounts(true);
                    try {
                      const query = new URLSearchParams({
                        operation: "unipile-accounts",
                        organizationId,
                        cursor: accountCursor,
                      });
                      const result = await requestJson<{
                        accounts: typeof accounts;
                        nextCursor: string | null;
                      }>(`/api/integrations?${query}`);
                      if (!alive.current) return;
                      setAccounts((current) => [
                        ...new Map(
                          [...current, ...result.accounts].map((account) => [
                            account.id,
                            account,
                          ]),
                        ).values(),
                      ]);
                      setAccountCursor(result.nextCursor);
                    } catch (cause) {
                      if (alive.current) setError(errorText(cause));
                    } finally {
                      if (alive.current) setLoadingAccounts(false);
                    }
                  }}
                >
                  {t.unipileLoadMoreAccounts}
                </button>
              )}
            </>
          )}
          <label>
            {t.defaultProduct}
            <select
              name="productId"
              required
              defaultValue={productId || data.products[0]?.id || ""}
              disabled={busy || !!connectionId || !!completedConnectionId}
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
          {provider === "gmail" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={allowSending}
                  disabled={busy}
                  onChange={(event) => setAllowSending(event.target.checked)}
                />
                {t.gmailSendingConsent}
              </label>
              <p className="muted">{t.gmailSendingConsentNote}</p>
            </>
          )}
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
            <button
              type="submit"
              className="primary"
              disabled={
                busy ||
                (v1 &&
                  !connectionId &&
                  !completedConnectionId &&
                  (loadingAccounts ||
                    !accounts.some((account) => account.status === "OK")))
              }
            >
              <ArrowRight size={15} aria-hidden="true" />
              {busy
                ? t.connecting
                : v1
                  ? completedConnectionId
                    ? t.unipileRetryWebhooks
                    : t.connectProvider.replace("{provider}", t.linkedin)
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
