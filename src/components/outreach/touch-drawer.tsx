"use client";
import type { JsonValue } from "@crm/core/dto";
import type { TouchContext } from "@crm/core/outreach";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useId, useRef, useState } from "react";
import { dateLabel, errorText, requestJson } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { usePersonContext } from "../crm/record-context";
import { submitOnSaveKey } from "../modal-lifecycle";
import { hasMergeFields, mergeParts } from "./merge-fields";
import { type Touch, useOutreachSend } from "./outreach-data";
import { followUpLabel, gateReason, mergePerson } from "./touch-labels";
import type { useTouchVerbs } from "./use-touch-verbs";

type Context = JsonValue<TouchContext>;
type Saved = { id: string; version: number; status: string };

function useTouchContext(touchId: string, version: number) {
  const { organizationId, notify, timeZone } = useCrm();
  const [context, setContext] = useState<Context | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    requestJson<Context>(
      `/api/outreach?operation=touch&organizationId=${organizationId}&touchId=${touchId}&version=${version}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setContext(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          notify(errorText(error, timeZone), "danger");
      });
    return () => controller.abort();
  }, [organizationId, touchId, version, notify, timeZone]);
  return context;
}

export function TouchDrawer({
  touch,
  edit,
  verbs,
  onClose,
}: {
  touch: Touch;
  edit: boolean;
  verbs: ReturnType<typeof useTouchVerbs>;
  onClose: () => void;
}) {
  const crm = useCrm();
  const send = useOutreachSend();
  const field = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const [editing, setEditing] = useState<{
    text: string;
    version: number;
  } | null>(null);
  const [accepted, setAccepted] = useState<{
    text: string;
    version: number;
  } | null>(null);
  const submitting = useRef(false);
  const current =
    accepted && accepted.version > touch.version ? accepted.text : touch.draft;
  const draft = editing?.text ?? current;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (edit) field.current?.focus();
  }, [edit]);
  const context = useTouchContext(touch.id, touch.version);
  const { context: person } = usePersonContext(touch.relationshipId);
  const relationship = crm.sourceData?.relationships.find(
    (item) => item.id === touch.relationshipId,
  );
  const stage = crm.sourceData?.outreachStages.find(
    (item) => item.id === (relationship?.stageId ?? touch.stageId),
  );
  const earlier = (context?.history ?? []).filter(
    (item) => item.id !== touch.id && item.stepNumber < touch.stepNumber,
  );
  const changed = editing !== null;
  const name = touch.person.name;
  async function save() {
    if (submitting.current || !editing) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await verbs.enqueue(() =>
        send<Saved>({
          operation: "draft",
          touchId: touch.id,
          version: editing.version,
          draft: editing.text,
        }),
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      verbs.remember(touch, result.result.version);
      setAccepted({ text: editing.text, version: result.result.version });
      setEditing(null);
      crm.notify(
        touch.status === "approved" && result.result.status !== "approved"
          ? t.draftSavedApprovalCleared
          : t.draftSaved,
        "success",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <section
      className="touch-drawer inline-touch-editor"
      data-record-editor
      data-dirty={changed || saving || undefined}
      aria-labelledby={titleId}
    >
      <div className="touch-drawer-main">
        <header className="touch-drawer-head">
          <h2 id={titleId}>{t.draftEditorTitle.replace("{name}", name)}</h2>
          <p className="muted touch-drawer-meta">
            {followUpLabel(touch.followUp)} · {t.touchStatus[touch.status]} ·{" "}
            {dateLabel(touch.dueAt, crm.timeZone)}
          </p>
          {touch.status === "approved" && !touch.allowed && (
            <p className="badge warning touch-gate">
              {touch.sendAfter
                ? t.sendAfter.replace(
                    "{time}",
                    dateLabel(touch.sendAfter, crm.timeZone),
                  )
                : touch.reasons
                    .map((reason) => gateReason(reason, crm.timeZone))
                    .join(" · ")}
            </p>
          )}
        </header>
        <form
          className="touch-draft"
          onKeyDown={submitOnSaveKey}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            {t.draftLabel}
            <textarea
              ref={field}
              rows={9}
              value={draft}
              disabled={saving}
              maxLength={20000}
              onChange={(event) => {
                const text = event.target.value;
                setEditing((previous) => ({
                  text,
                  version: previous?.version ?? verbs.versionOf(touch),
                }));
                setError("");
              }}
            />
          </label>
          {hasMergeFields(draft) && (
            <section aria-label={t.mergePreview} className="merge-preview">
              <span className="field-hint muted">{t.mergePreview}</span>
              <p className="touch-message-body">
                {mergeParts(draft, mergePerson(crm, touch.person)).map(
                  (part, index) =>
                    part.missing ? (
                      <mark
                        key={`${index.toString()}-${part.text}`}
                        className="merge-missing"
                      >
                        {part.text}
                      </mark>
                    ) : (
                      part.text
                    ),
                )}
              </p>
            </section>
          )}
          {touch.status === "approved" && (
            <p className="field-hint warning-text">{t.approvalClearsOnEdit}</p>
          )}
          {changed && <p className="field-hint muted">{t.draftChanged}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions touch-draft-actions">
            <span className="muted field-hint">{t.draftSaveHint}</span>
            {changed && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setEditing(null);
                  setError("");
                }}
              >
                {t.cancel}
              </button>
            )}
            <button
              type="submit"
              className="primary"
              disabled={saving || !changed}
            >
              {saving ? t.saving : t.saveDraft}
            </button>
          </div>
        </form>
        <div className="touch-drawer-verbs">
          <button
            type="button"
            disabled={changed || touch.status === "approved"}
            onClick={() => verbs.approve(touch)}
          >
            {t.touchVerbs.approve}
          </button>
          {verbs.canSend(touch) && (
            <button
              type="button"
              className="primary"
              disabled={changed}
              onClick={() => verbs.askSend(touch)}
            >
              {t.touchVerbs.send}
            </button>
          )}
          <button
            type="button"
            disabled={changed || saving}
            onClick={() => verbs.askSent(touch)}
          >
            {t.touchVerbs.sent}
          </button>
          <button
            type="button"
            disabled={changed || saving}
            onClick={() => verbs.askSkip(touch)}
          >
            {t.touchVerbs.skip}
          </button>
          <button
            type="button"
            disabled={changed || saving}
            onClick={() => verbs.snooze(touch)}
          >
            {t.touchVerbs.snooze}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (!crm.canLeaveEditor()) return;
              onClose();
              crm.openPerson(touch.relationshipId);
            }}
          >
            {t.openPerson}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={saving}
            onClick={onClose}
          >
            {t.close}
          </button>
        </div>
      </div>
      <aside className="touch-drawer-context" aria-label={t.touchContext}>
        <dl>
          <dt>{t.outreachStage}</dt>
          <dd>{stage?.name ?? t.unknown}</dd>
          <dt>{t.nextStepLabel}</dt>
          <dd>
            {relationship?.nextStep || t.noNextStep}
            {relationship?.nextStepDueAt && (
              <small className="muted">
                {" "}
                · {dateLabel(relationship.nextStepDueAt, crm.timeZone)}
              </small>
            )}
          </dd>
        </dl>
        <h3>{t.lastMessages}</h3>
        {person?.messages.length ? (
          <ol className="touch-messages">
            {person.messages.slice(0, 3).map((message) => (
              <li key={message.id}>
                <small className="muted">
                  {message.direction === "inbound" ? t.inbound : t.outbound} ·{" "}
                  {dateLabel(message.occurredAt, crm.timeZone)}
                </small>
                <p className="touch-message-body">{message.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">{t.noMessages}</p>
        )}
        {earlier.length > 0 && (
          <>
            <h3>{t.earlierTouches}</h3>
            <ol className="touch-messages">
              {earlier.map((item) => (
                <li key={item.id}>
                  <small className="muted">
                    {followUpLabel(item.followUp)} ·{" "}
                    {t.touchStatus[item.status]}
                    {item.sentAt
                      ? ` · ${dateLabel(item.sentAt, crm.timeZone)}`
                      : ""}
                  </small>
                  <p className="touch-message-body">{item.draft}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </section>
  );
}
