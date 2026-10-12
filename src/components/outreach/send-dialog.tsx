"use client";
import type { OutboundService } from "@crm/connectors/outbound";
import type {
  ConnectionOverview,
  PublicConnection,
} from "@crm/connectors/service";
import type { JsonValue } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { errorText, label, RequestError, requestJson } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { useModalLifecycle } from "../modal-lifecycle";
import { ConversationThread } from "../records/conversation-thread";
import { personPath } from "../routes";
import { ErrorState, LoadingState } from "../ui/states";
import { gateReason } from "./touch-labels";
import "./send-dialog.css";

type Readiness = JsonValue<Awaited<ReturnType<OutboundService["readiness"]>>>;
type Delivery = { id: string; status: string; errorCode: string | null };
export type SendSource = {
  kind: "touch" | "action";
  id: string;
  version: number;
  channel: string;
  name: string;
  relationshipId: string;
};

const providerFor = (channel: string) =>
  channel === "linkedin" ? "linkedin" : "gmail";

function newIdempotencyKey() {
  return `ui-${crypto.randomUUID()}`;
}

function useSendConnections(channel: string, enabled: boolean) {
  const { organizationId } = useCrm();
  const key = `${organizationId}:${channel}`;
  const [state, setState] = useState<{
    key: string;
    connections: PublicConnection[] | null;
    error: string;
  }>({ key: "", connections: null, error: "" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    requestJson<ConnectionOverview>(
      `/api/integrations?organizationId=${organizationId}`,
      { signal: controller.signal },
    )
      .then((overview) => {
        if (controller.signal.aborted) return;
        setState({
          key,
          connections: overview.connections.filter(
            (connection) => connection.provider === providerFor(channel),
          ),
          error: "",
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key, connections: null, error: errorText(error) });
      });
    return () => controller.abort();
  }, [organizationId, channel, enabled, key]);
  return state.key === key ? state : { connections: null, error: "" };
}

function useReadiness(source: SendSource, connectionId: string) {
  const { organizationId } = useCrm();
  const [state, setState] = useState<{
    key: string;
    readiness: Readiness | null;
    error: string;
  }>({ key: "", readiness: null, error: "" });
  const key = JSON.stringify([
    organizationId,
    source.kind,
    source.id,
    source.version,
    connectionId,
  ]);
  useEffect(() => {
    if (!connectionId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      operation: "send-readiness",
      organizationId,
      [source.kind === "touch" ? "touchId" : "actionId"]: source.id,
      version: String(source.version),
      connectionId,
    });
    requestJson<Readiness>(`/api/outreach?${query}`, {
      signal: controller.signal,
    })
      .then((readiness) => {
        if (!controller.signal.aborted) setState({ key, readiness, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key, readiness: null, error: errorText(error) });
      });
    return () => controller.abort();
  }, [
    organizationId,
    source.kind,
    source.id,
    source.version,
    connectionId,
    key,
  ]);
  return state.key === key ? state : { readiness: null, error: "" };
}

export function SendDialog({
  source,
  onClose,
  onSent,
}: {
  source: SendSource;
  onClose: () => void;
  onSent: () => void;
}) {
  const crm = useCrm();
  const modal = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const statusId = useId();
  const sending = useRef(false);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [threadLinked, setThreadLinked] = useState(false);
  const [chosen, setChosen] = useState("");
  useModalLifecycle(modal);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  const { connections, error: connectionError } = useSendConnections(
    source.channel,
    !crm.demo,
  );
  const connection =
    connections?.find((item) => item.id === chosen) ??
    connections?.find((item) => item.canSend) ??
    connections?.[0];
  const { readiness, error: readinessError } = useReadiness(
    source,
    connection?.id ?? "",
  );
  const ready = !!readiness?.ready && !busy;
  async function send() {
    if (!readiness?.ready || !connection || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setThreadLinked(false);
    try {
      const delivery = await requestJson<Delivery>("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: source.kind === "touch" ? "send-touch" : "send-action",
          organizationId: crm.organizationId,
          [source.kind === "touch" ? "touchId" : "actionId"]: source.id,
          version: source.version,
          connectionId: connection.id,
          ...(readiness.conversationId
            ? { conversationId: readiness.conversationId }
            : {}),
          idempotencyKey,
        }),
      });
      if (delivery.status === "failed") {
        setError(
          t.sendRefused.replace("{code}", delivery.errorCode ?? t.unknown),
        );
        return;
      }
      crm.notify(
        (delivery.status === "sent"
          ? t.messageSent
          : t.sendOutcomeUnknown
        ).replace("{name}", source.name),
        delivery.status === "sent" ? "success" : "neutral",
      );
      void crm.refresh();
      onSent();
      onClose();
    } catch (cause) {
      setError(errorText(cause, crm.timeZone));
      setThreadLinked(
        cause instanceof Error && cause.message === "THREAD_ALREADY_LINKED",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const blockedReason = (value: Readiness) => {
    const reasons = value.policy.reasons
      .map((reason) =>
        gateReason(
          {
            code: reason.code,
            ...("until" in reason && reason.until !== undefined
              ? { until: String(reason.until) }
              : {}),
            ...("cap" in reason ? { cap: reason.cap } : {}),
          },
          crm.timeZone,
        ),
      )
      .filter(Boolean);
    const main = errorText(
      new RequestError(value.blockedBy ?? "INTERNAL_ERROR"),
      crm.timeZone,
    );
    return value.blockedBy === "CONTACT_POLICY_BLOCKED" && reasons.length
      ? `${main} ${reasons.join(" · ")}`
      : main;
  };
  const loadError = connectionError || readinessError;
  const recipient = crm.personFor(source.relationshipId);
  const body = crm.demo ? (
    <>
      <dl className="send-summary">
        <dt>{t.sendRecipient}</dt>
        <dd>
          {(source.channel === "linkedin"
            ? recipient?.linkedinUrl
            : recipient?.email) || t.unknown}
        </dd>
        <dt>{t.channel}</dt>
        <dd>{label(source.channel)}</dd>
      </dl>
      <p className="muted">{t.sendDemoUnavailable}</p>
    </>
  ) : loadError ? (
    <ErrorState title={loadError} />
  ) : !connections ? (
    <LoadingState rows={2} label={t.sendChecking} />
  ) : !connection ? (
    <p className="muted">
      {t.sendNoAccount.replace("{channel}", label(source.channel))}
    </p>
  ) : (
    <>
      <dl className="send-summary">
        <dt>{t.sendRecipient}</dt>
        <dd>{readiness ? (readiness.recipient ?? t.unknown) : "…"}</dd>
        <dt>{t.channel}</dt>
        <dd>{label(source.channel)}</dd>
        <dt>
          <label htmlFor={`${titleId}-account`}>{t.sendAccount}</label>
        </dt>
        <dd>
          <select
            id={`${titleId}-account`}
            value={connection.id}
            disabled={busy}
            onChange={(event) => setChosen(event.target.value)}
          >
            {connections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
        </dd>
      </dl>
      <p
        id={statusId}
        className={`field-hint ${readiness && !readiness.ready ? "warning-text" : "muted"}`}
        aria-live="polite"
      >
        {!readiness
          ? t.sendChecking
          : readiness.ready
            ? t.sendReady
            : blockedReason(readiness)}
      </p>
      {readiness?.draft && (
        <section
          className="send-message-preview"
          aria-label={t.draftFlow.messagePreview}
        >
          <div className="section-heading">
            <h3>{t.draftFlow.messagePreview}</h3>
            {readiness.approved && <span className="badge">{t.approved}</span>}
          </div>
          <p>{readiness.draft}</p>
        </section>
      )}
      {readiness?.history && (
        <details className="send-history" open>
          <summary>
            {t.nativeIngestion.sendHistory}
            <span className="badge">{readiness.history.messages.length}</span>
          </summary>
          {readiness.history.messages.length ? (
            <section
              className="send-history-scroll"
              aria-label={t.nativeIngestion.sendHistory}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable history needs keyboard focus so arrow keys can reach earlier messages.
              tabIndex={0}
            >
              <ConversationThread
                messages={readiness.history.messages}
                personName={source.name}
                timeZone={crm.timeZone}
                compact
              />
            </section>
          ) : (
            <p className="muted">{t.nativeIngestion.noVisibleHistory}</p>
          )}
          <p className="field-hint">{t.nativeIngestion.historyCoverage}</p>
          {recipient && (
            <Link
              href={personPath(recipient.id, {
                relationshipId: source.relationshipId,
              })}
            >
              {t.openPersonRecord.replace("{name}", recipient.name)}
            </Link>
          )}
        </details>
      )}
      {readiness?.checks?.exclusions &&
        readiness.checks.crossChannel &&
        readiness.checks.history && (
          <p className="field-hint">{t.nativeIngestion.exclusionChecked}</p>
        )}
    </>
  );
  return (
    <dialog
      ref={modal}
      className="dialog send-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <header className="send-dialog-heading">
        <span className="send-dialog-icon">
          <Send size={20} aria-hidden />
        </span>
        <h2 id={titleId}>{t.sendTitle.replace("{name}", source.name)}</h2>
      </header>
      <div className="send-dialog-content">
        {body}
        {error && (
          <p role="alert">
            {error}
            {threadLinked && recipient && (
              <>
                {" "}
                <Link
                  href={personPath(recipient.id, {
                    relationshipId: source.relationshipId,
                  })}
                  onClick={onClose}
                >
                  {t.openPersonRecord.replace("{name}", recipient.name)}
                </Link>
              </>
            )}
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button
          ref={cancel}
          data-modal-cancel
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          {t.cancel}
        </button>
        {!crm.demo && (
          <button
            type="button"
            className="primary"
            disabled={!ready}
            aria-describedby={statusId}
            onClick={() => void send()}
          >
            {busy ? t.sendingNow : t.sendNow}
          </button>
        )}
      </div>
    </dialog>
  );
}
