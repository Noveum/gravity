"use client";
import type { ClientContext, ClientSnapshot } from "@crm/core/dto";
import { shortcutFor } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import { ArrowUpRight } from "lucide-react";
import { dateLabel, label } from "../client-api";
import { type RecordTab, useCrm } from "../crm/crm-context";
import type { useDraft } from "../crm/use-draft";
import { keyInput } from "../keyboard-navigation";
import { initials } from "../shell/workspace-menu";
import { ShortcutHint } from "../ui/shortcut-hint";

type Action = ClientSnapshot["actions"][number];
type DraftState = ReturnType<typeof useDraft>;

export function findAction(
  actionId: string,
  snapshot: ClientSnapshot | null,
  context: ClientContext | null,
): Action | undefined {
  if (!actionId) return undefined;
  return (
    snapshot?.actions.find((action) => action.id === actionId) ??
    context?.actions.find((action) => action.id === actionId)
  );
}

export function PersonProfile({
  name,
  title,
  company,
  onCompany,
  recordHeading = false,
}: {
  name: string;
  title: string | null;
  company: { id: string; name: string } | null | undefined;
  onCompany: (companyId: string) => void;
  recordHeading?: boolean;
}) {
  return (
    <div className="profile">
      <span className="profile-avatar">{initials(name)}</span>
      <div>
        <h2
          tabIndex={recordHeading ? -1 : undefined}
          data-record-heading={recordHeading ? "" : undefined}
        >
          {name}
        </h2>
        <p>{title}</p>
        <small>
          {company && (
            <button
              type="button"
              className="text-button"
              onClick={() => onCompany(company.id)}
            >
              {company.name}
            </button>
          )}
        </small>
      </div>
    </div>
  );
}

export function RelationshipProperties({
  context,
  action,
}: {
  context: ClientContext;
  action: Action | undefined;
}) {
  const { product, member } = useCrm();
  return (
    <>
      <dl className="properties">
        <dt>{t.product}</dt>
        <dd>{product(context.relationship.productId)?.name}</dd>
        <dt>{t.owner}</dt>
        <dd>{member(context.relationship.ownerId)}</dd>
        <dt>{t.purpose}</dt>
        <dd>{label(context.relationship.purpose)}</dd>
        <dt>{t.qualification}</dt>
        <dd>{label(context.relationship.qualification)}</dd>
        {action && (
          <>
            <dt>{t.owedBy}</dt>
            <dd>{label(action.owedBy)}</dd>
          </>
        )}
      </dl>
      <p className="context-summary">{context.relationship.context}</p>
    </>
  );
}

export function PersonActivity({
  context,
  action,
  draft,
}: {
  context: ClientContext;
  action: Action | undefined;
  draft: DraftState;
}) {
  const { tab, setTab, timeZone } = useCrm();
  const tabs: RecordTab[] = [
    "timeline",
    "evidence",
    ...(action ? ["draft" as const] : []),
  ];
  const current = tab === "draft" && !action ? "timeline" : tab;
  return (
    <>
      <div className="tabs">
        {tabs.map((value) => (
          <button
            type="button"
            key={value}
            data-inspector-tab={value}
            aria-keyshortcuts={String(tabs.indexOf(value) + 1)}
            aria-pressed={current === value}
            onClick={() => setTab(value)}
          >
            {label(value)}
            <ShortcutHint id={value} />
          </button>
        ))}
      </div>
      {current === "timeline" && (
        <>
          <div className="timeline">
            {context.messages.length ? (
              context.messages.map((message) => (
                <article className="timeline-event" key={message.id}>
                  <span className={`event-dot ${message.direction}`} />
                  <div className="event-title">
                    {message.direction === "inbound" ? t.incoming : t.outgoing}
                    <small>
                      {label(message.channel)} ·{" "}
                      {dateLabel(message.occurredAt, timeZone)}
                    </small>
                  </div>
                  <p>{message.body}</p>
                </article>
              ))
            ) : (
              <p className="muted">{t.noMessages}</p>
            )}
          </div>
          <p className="coverage-note">{t.partialHistory}</p>
        </>
      )}
      {current === "evidence" && (
        <>
          {context.evidence.map((item) => (
            <article className="evidence-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span className="badge">{label(item.classification)}</span>
              </div>
              <p>{item.excerpt}</p>
              <small>
                {item.source} · {dateLabel(item.observedAt, timeZone)}
              </small>
            </article>
          ))}
          {!context.evidence.length && <p className="muted">{t.noEvidence}</p>}
        </>
      )}
      {current === "draft" && action && (
        <DraftPanel action={action} draft={draft} />
      )}
    </>
  );
}

function DraftPanel({ action, draft }: { action: Action; draft: DraftState }) {
  const { busy, mutate, organizationId } = useCrm();
  const change = (command: string, extra: object = {}) =>
    void mutate({
      operation: "action",
      organizationId,
      actionId: action.id,
      version: draft.version,
      command,
      ...extra,
    });
  return (
    <div className="draft-panel">
      {action.status === "blocked" && (
        <p className="callout warning-text">{t.blockedDetail}</p>
      )}
      {action.kind === "review" && <p className="callout">{t.reviewOnly}</p>}
      <label className="sr-only" htmlFor="message-draft">
        {t.draftLabel}
      </label>
      <textarea
        maxLength={20000}
        disabled={busy}
        onKeyDown={(event) => {
          if (shortcutFor(keyInput(event), ["dialog"], true) === "save") {
            event.preventDefault();
            event.currentTarget.parentElement
              ?.querySelector<HTMLButtonElement>(
                "[data-save-draft]:not(:disabled)",
              )
              ?.click();
          }
        }}
        id="message-draft"
        value={draft.draft}
        onChange={(event) => draft.edit(event.target.value)}
        rows={9}
      />
      <div className="draft-state">
        {draft.draft !== action.draft
          ? t.draftChanged
          : action.approvedHash
            ? t.approved
            : t.draft}
      </div>
      {draft.version !== action.version && (
        <div className="callout warning-text">
          {t.errors.CONFLICT}
          <button type="button" onClick={draft.reload}>
            {t.reloadDraft}
          </button>
        </div>
      )}
      <p className="muted">{t.approvalNote}</p>
      <div className="button-row">
        {action.status === "blocked" ? (
          <button
            type="button"
            className="primary"
            disabled={
              busy || !draft.draft.trim() || draft.draft === action.draft
            }
            onClick={() => change("rework", { draft: draft.draft })}
          >
            {t.rework}
          </button>
        ) : (
          <>
            <button
              data-save-draft
              type="button"
              disabled={busy || draft.draft === action.draft}
              onClick={() => change("save", { draft: draft.draft })}
            >
              {t.saveDraft}
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                !draft.draft.trim() ||
                draft.draft !== action.draft ||
                !!action.approvedHash
              }
              onClick={() => change("approve")}
            >
              {t.approveDraft}
            </button>
          </>
        )}
      </div>
      <p className="coverage-note">
        {t.draftSaveHint} · {t.sendingUnavailable}
      </p>
    </div>
  );
}

export function ActionSummary({
  action,
  version,
}: {
  action: Action;
  version: number;
}) {
  const { busy, mutate, organizationId } = useCrm();
  return (
    <div className="action-summary">
      <span className="eyebrow">{t.actions}</span>
      <h3>{action.title}</h3>
      <p>{action.reason}</p>
      <button
        type="button"
        disabled={
          busy || action.status === "blocked" || action.status === "completed"
        }
        onClick={() =>
          void mutate({
            operation: "action",
            organizationId,
            actionId: action.id,
            version,
            command: "complete",
          })
        }
      >
        {t.markDone}
        <ArrowUpRight size={13} />
      </button>
    </div>
  );
}
