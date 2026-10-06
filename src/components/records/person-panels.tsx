"use client";
import type { ClientContext, ClientSnapshot } from "@crm/core/dto";
import { shortcutFor } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import { Check } from "lucide-react";
import { useState } from "react";
import { dateLabel, label } from "../client-api";
import { type RecordTab, useCrm } from "../crm/crm-context";
import type { useDraft } from "../crm/use-draft";
import { keyInput } from "../keyboard-navigation";
import { SendDialog } from "../outreach/send-dialog";
import { initials } from "../shell/workspace-menu";
import { ShortcutHint } from "../ui/shortcut-hint";
import { PersonFields } from "./contact-fields";
import { ConversationHistory } from "./conversation-history";
import { ConversationSharing } from "./conversation-sharing";
import { RecordText } from "./record-text";
import { RelationshipContext } from "./relationship-context";

type Action = ClientSnapshot["actions"][number];
type DraftState = ReturnType<typeof useDraft>;

export function findAction(
  actionId: string,
  snapshot: ClientSnapshot | null,
  context: ClientContext | null,
): Action | undefined {
  if (!actionId) return undefined;
  const action = snapshot?.actions.find((action) => action.id === actionId);
  const detail = context?.actions.find((action) => action.id === actionId);
  if (snapshot?.compact && action && detail)
    return { ...action, reason: detail.reason };
  return action ?? detail;
}

export function PersonProfile({
  name,
  title,
  company,
  onCompany,
  recordHeading = false,
  person,
}: {
  name: string;
  title: string | null;
  company: { id: string; name: string } | null | undefined;
  onCompany: (companyId: string) => void;
  recordHeading?: boolean;
  person?: NonNullable<ClientContext["person"]>;
}) {
  return (
    <div className="profile">
      <span className="profile-avatar">{initials(name)}</span>
      <div>
        <h2
          className={person ? "sr-only" : undefined}
          tabIndex={recordHeading ? -1 : undefined}
          data-record-heading={recordHeading ? "" : undefined}
        >
          {name}
        </h2>
        {person ? <PersonFields person={person} profile /> : <p>{title}</p>}
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
  includeContext = true,
}: {
  includeContext?: boolean;
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
      {includeContext && (
        <RelationshipContext
          key={context.relationship.id}
          relationship={context.relationship}
        />
      )}
    </>
  );
}

export function PersonActivity({
  context,
  action,
  draft,
  hideTabs = false,
  mode,
}: {
  context: ClientContext;
  action: Action | undefined;
  draft: DraftState;
  hideTabs?: boolean;
  mode?: RecordTab;
}) {
  const { tab, setTab, timeZone, userId, product, send, busy, organizationId } =
    useCrm();
  const tabs: RecordTab[] = [
    "timeline",
    "evidence",
    ...(action ? ["draft" as const] : []),
  ];
  const current =
    (mode ?? tab) === "draft" && !action ? "timeline" : (mode ?? tab);
  return (
    <>
      {!hideTabs && (
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
              <ShortcutHint id={value as "timeline" | "evidence" | "draft"} />
            </button>
          ))}
        </div>
      )}
      {current === "timeline" && (
        <ConversationHistory context={context} timeZone={timeZone} />
      )}
      {current === "details" && (
        <ConversationSharing
          conversations={context.conversations ?? []}
          userId={userId}
          productName={
            product(context.relationship.productId)?.name ?? t.product
          }
          busy={busy}
          onChange={async (source, visibility) => {
            const result = await send(
              {
                operation: "conversation-sharing",
                organizationId,
                productId: context.relationship.productId,
                conversationId: source.id,
                expectedVisibility: source.visibility,
                visibility,
              },
              false,
              false,
            );
            return result.ok ? null : (result.error ?? t.errors.INTERNAL_ERROR);
          }}
        />
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
  const { busy, mutate, organizationId, userId, personFor } = useCrm();
  const [sending, setSending] = useState(false);
  const canSend =
    action.status === "open" &&
    !!action.approvedHash &&
    action.ownerId === userId &&
    (action.channel === "gmail" || action.channel === "linkedin") &&
    draft.draft === action.draft &&
    draft.version === action.version;
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
      <h3>{action.title}</h3>
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
            {canSend && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => setSending(true)}
              >
                {t.touchVerbs.send}
              </button>
            )}
          </>
        )}
      </div>
      <p className="coverage-note">
        {t.draftSaveHint} · {t.sendingNote}
      </p>
      {sending && (
        <SendDialog
          source={{
            kind: "action",
            id: action.id,
            version: action.version,
            channel: action.channel,
            name: personFor(action.relationshipId)?.name ?? t.unknown,
            relationshipId: action.relationshipId,
          }}
          onClose={() => setSending(false)}
          onSent={() => setSending(false)}
        />
      )}
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
  const { busy, mutate, organizationId, timeZone } = useCrm();
  return (
    <div className="action-summary">
      <h3>{action.title}</h3>
      <p className="muted action-due">
        {label(action.kind)} · {label(action.status)} ·{" "}
        {dateLabel(action.dueAt, timeZone)}
      </p>
      <RecordText value={action.reason} />
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
        <Check size={13} />
      </button>
    </div>
  );
}
