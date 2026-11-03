"use client";
import { instantFromZonedInput, zonedInputValue } from "@crm/core/calendar";
import type { ClientContext, ClientSnapshot } from "@crm/core/dto";
import { shortcutFor } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import { CalendarClock, Check, Send } from "lucide-react";
import { useState } from "react";
import { dateLabel, label } from "../client-api";
import { type RecordTab, useCrm } from "../crm/crm-context";
import type { useDraft } from "../crm/use-draft";
import { keyInput } from "../keyboard-navigation";
import { SendDialog } from "../outreach/send-dialog";
import { initials } from "../shell/workspace-menu";
import { ShortcutHint } from "../ui/shortcut-hint";
import { ActionReason } from "./action-reason";
import { PersonFields } from "./contact-fields";
import { ConversationHistory } from "./conversation-history";
import { ConversationSharing } from "./conversation-sharing";
import { NativeIngestionPanel } from "./native-ingestion-panel";
import { RecordDialog } from "./record-dialog";
import { RelationshipContext } from "./relationship-context";
import { YoduLifecyclePanel } from "./yodu-lifecycle";
import "./draft-panels.css";

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
    return {
      ...action,
      reason: detail.reason,
      reasonSource: detail.reasonSource,
    };
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
        <>
          <ConversationHistory context={context} timeZone={timeZone} />
          <NativeIngestionPanel
            relationshipId={context.relationship.id}
            productId={context.relationship.productId}
          />
        </>
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
          <YoduLifecyclePanel
            organizationId={organizationId}
            productId={context.relationship.productId}
            relationshipId={context.relationship.id}
            timeZone={timeZone}
            revision={context.asOf}
          />
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
        <DraftPanel key={action.id} action={action} draft={draft} />
      )}
    </>
  );
}

function DraftPanel({ action, draft }: { action: Action; draft: DraftState }) {
  const { busy, mutate, send, organizationId, userId, personFor, timeZone } =
    useCrm();
  const [sending, setSending] = useState(false);
  const [schedule, setSchedule] = useState<{
    actionId: string;
    version: number;
    dueAt: string;
    timeZone: string;
  } | null>(null);
  const dirty = draft.draft !== action.draft;
  const stale = draft.version !== action.version;
  const sendableAction =
    ["reply", "approval", "commitment"].includes(action.kind) &&
    action.owedBy === "us";
  const canSend =
    sendableAction &&
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
      <header className="draft-panel-heading">
        <div>
          <span className="draft-eyebrow">{t.draftFlow.reply}</span>
          <h3>{action.title}</h3>
        </div>
        <span className="badge">{label(action.channel)}</span>
      </header>
      {action.status === "blocked" && (
        <p className="callout warning-text">{t.blockedDetail}</p>
      )}
      {!sendableAction && (
        <p className="callout">{t.errors.SOURCE_NOT_SENDABLE}</p>
      )}
      <label className="sr-only" htmlFor="message-draft">
        {t.draftLabel}
      </label>
      <textarea
        maxLength={20000}
        disabled={busy}
        onKeyDown={(event) => {
          if (shortcutFor(keyInput(event), ["dialog"], true) === "save") {
            event.preventDefault();
            event.currentTarget
              .closest(".draft-panel")
              ?.querySelector<HTMLButtonElement>(
                "[data-save-draft]:not(:disabled)",
              )
              ?.click();
          }
        }}
        id="message-draft"
        value={draft.draft}
        onChange={(event) => draft.edit(event.target.value)}
        rows={7}
      />
      <div className="draft-editor-status">
        <div className="draft-state" aria-live="polite">
          {!dirty && !!draft.draft.trim() && (
            <Check size={13} aria-hidden="true" />
          )}
          {dirty
            ? t.draftChanged
            : !draft.draft.trim()
              ? t.draftFlow.empty
              : action.approvedHash
                ? t.approved
                : t.draftFlow.saved}
        </div>
        <span className="draft-scheduled-date">
          <CalendarClock size={13} aria-hidden="true" />
          {t.draftFlow.scheduledFor.replace(
            "{date}",
            dateLabel(action.dueAt, timeZone),
          )}
        </span>
      </div>
      {stale && (
        <div className="callout warning-text">
          {t.errors.CONFLICT}
          <button type="button" onClick={draft.reload}>
            {t.reloadDraft}
          </button>
        </div>
      )}
      <fieldset className="draft-actions" aria-label={t.draftFlow.actions}>
        {action.status === "blocked" ? (
          <button
            type="button"
            className="primary"
            disabled={busy || stale || !draft.draft.trim() || !dirty}
            onClick={() => change("rework", { draft: draft.draft })}
          >
            {t.rework}
          </button>
        ) : (
          <>
            <button
              data-save-draft
              type="button"
              className={dirty ? "primary" : undefined}
              disabled={busy || stale || !dirty}
              onClick={() => change("save", { draft: draft.draft })}
            >
              {t.saveDraft}
            </button>
            {!action.approvedHash && (
              <button
                type="button"
                className={!dirty ? "primary" : undefined}
                aria-label={t.approveDraft}
                disabled={
                  busy ||
                  stale ||
                  !draft.draft.trim() ||
                  dirty ||
                  action.status !== "open"
                }
                onClick={() => change("approve")}
              >
                {t.draftFlow.approve}
              </button>
            )}
          </>
        )}
        {action.status === "open" && (
          <>
            <button
              type="button"
              disabled={busy || dirty || stale || !draft.draft.trim()}
              onClick={() =>
                setSchedule({
                  actionId: action.id,
                  version: draft.version,
                  dueAt: action.dueAt,
                  timeZone,
                })
              }
            >
              <CalendarClock size={15} aria-hidden="true" />
              {t.draftFlow.schedule}
            </button>
            {sendableAction &&
              (action.channel === "gmail" || action.channel === "linkedin") && (
                <button
                  type="button"
                  className={canSend ? "primary" : undefined}
                  aria-label={t.touchVerbs.send}
                  disabled={busy || !canSend}
                  title={!canSend ? t.draftFlow.sendHint : undefined}
                  onClick={() => setSending(true)}
                >
                  <Send size={15} aria-hidden="true" />
                  {t.draftFlow.send}
                </button>
              )}
          </>
        )}
      </fieldset>
      <div className="draft-action-help">
        <span>{t.draftSaveHint}</span>
        <details>
          <summary>{t.draftFlow.approvalHelp}</summary>
          <p>{t.approvalNote}</p>
          <p>{t.sendingNote}</p>
        </details>
      </div>
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
      {schedule !== null && (
        <RecordDialog
          title={t.draftFlow.scheduleTitle}
          submitLabel={t.draftFlow.schedule}
          onClose={() => setSchedule(null)}
          onSubmit={async (fields) => {
            const dueAt = instantFromZonedInput(
              String(fields.get("dueAt") ?? ""),
              String(fields.get("timeZone") ?? ""),
            );
            if (!dueAt) return t.errors.INVALID_INPUT;
            const result = await send(
              {
                operation: "plan",
                organizationId,
                items: [
                  {
                    actionId: schedule.actionId,
                    version: schedule.version,
                    dueAt,
                  },
                ],
              },
              false,
              false,
            );
            return result.ok ? null : (result.error ?? t.errors.INTERNAL_ERROR);
          }}
        >
          <p className="field-hint">{t.draftFlow.scheduleHint}</p>
          <label>
            {t.nativeIngestion.dueAt}
            <input
              name="dueAt"
              data-primary-field
              type="datetime-local"
              step="0.001"
              defaultValue={zonedInputValue(
                schedule.dueAt,
                schedule.timeZone,
                true,
              )}
              required
            />
          </label>
          <label>
            {t.timezone}
            <select
              name="timeZone"
              value={schedule.timeZone}
              onChange={(event) =>
                setSchedule({ ...schedule, timeZone: event.target.value })
              }
            >
              {[...new Set([timeZone, schedule.timeZone, "UTC"])].map(
                (zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ),
              )}
            </select>
          </label>
          <p className="field-hint">
            {t.nativeIngestion.zone.replace("{zone}", schedule.timeZone)}
          </p>
        </RecordDialog>
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
      <ActionReason key={action.id} action={action} />
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
