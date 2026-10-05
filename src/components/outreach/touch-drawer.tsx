"use client";
import type { JsonValue } from "@crm/core/dto";
import type { TouchContext } from "@crm/core/outreach";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useId, useRef, useState } from "react";
import { dateLabel, errorText, requestJson } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { usePersonContext } from "../crm/record-context";
import { submitOnSaveKey, useModalLifecycle } from "../modal-lifecycle";
import { personPath } from "../routes";
import { hasMergeFields, mergeParts } from "./merge-fields";
import { type Touch, useOutreachSend } from "./outreach-data";
import { followUpLabel, gateReason, mergePerson } from "./touch-labels";
import type { useTouchVerbs } from "./use-touch-verbs";

type Context = JsonValue<TouchContext>;
type Saved = { id: string; version: number; status: string };
const unsaved = new Map<string, string>();

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
  const modal = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState(
    () => unsaved.get(touch.id) ?? touch.draft,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useModalLifecycle(modal);
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
  const changed = draft !== touch.draft;
  const name = touch.person.name;
  async function save() {
    if (saving || !changed) return;
    setSaving(true);
    setError("");
    const result = await verbs.enqueue(() =>
      send<Saved>({
        operation: "draft",
        touchId: touch.id,
        version: verbs.versionOf(touch),
        draft,
      }),
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    verbs.remember(touch, result.result.version);
    unsaved.delete(touch.id);
    crm.notify(
      touch.status === "approved" && result.result.status !== "approved"
        ? t.draftSavedApprovalCleared
        : t.draftSaved,
      "success",
    );
  }
  return (
    <dialog
      ref={modal}
      className="dialog touch-drawer"
      aria-labelledby={titleId}
      onCancel={onClose}
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
              onChange={(event) => {
                setDraft(event.target.value);
                unsaved.set(touch.id, event.target.value);
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
          <button type="button" onClick={() => verbs.askSent(touch)}>
            {t.touchVerbs.sent}
          </button>
          <button type="button" onClick={() => verbs.askSkip(touch)}>
            {t.touchVerbs.skip}
          </button>
          <button type="button" onClick={() => verbs.snooze(touch)}>
            {t.touchVerbs.snooze}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              onClose();
              crm.go(
                personPath(touch.person.id, {
                  relationshipId: touch.relationshipId,
                }),
              );
            }}
          >
            {t.openPerson}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
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
    </dialog>
  );
}
