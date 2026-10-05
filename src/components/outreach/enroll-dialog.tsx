"use client";
import t from "@crm/i18n/translations/en.json";
import { useId, useRef, useState } from "react";
import { useCrm } from "../crm/crm-context";
import {
  submitOnSaveKey,
  useModalLifecycle,
  useReadyFocus,
} from "../modal-lifecycle";
import { useOutreachSend } from "./outreach-data";

interface Enrollment {
  dryRun: boolean;
  enrolled: { relationshipId: string; enrollmentId: string | null }[];
  skipped: { relationshipId: string; reason: string }[];
}

export const peopleCount = (count: number) =>
  count === 1
    ? t.personCountOne
    : t.personCount.replace("{count}", String(count));

export function EnrollDialog({
  personIds,
  onClose,
  onEnrolled,
}: {
  personIds: readonly string[];
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const crm = useCrm();
  const send = useOutreachSend();
  const modal = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const willId = useId();
  const skippedId = useId();
  const sequences = crm.data?.sequences ?? [];
  const [sequenceId, setSequenceId] = useState(sequences[0]?.id ?? "");
  const [review, setReview] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useModalLifecycle(modal);
  useReadyFocus(modal, false);
  const source = crm.sourceData;
  const people = personIds.flatMap((id) => {
    const person = source?.people.find((item) => item.id === id);
    return person ? [person] : [];
  });
  const sequence = sequences.find((item) => item.id === sequenceId);
  const relationshipFor = (personId: string) => {
    const owned = (source?.relationships ?? []).filter(
      (relationship) => relationship.personId === personId,
    );
    return (
      owned.find(
        (relationship) => relationship.productId === sequence?.productId,
      ) ?? owned[0]
    );
  };
  const relationshipIds = people.flatMap((person) => {
    const relationship = relationshipFor(person.id);
    return relationship ? [relationship.id] : [];
  });
  const nameOf = (relationshipId: string) => {
    const personId = source?.relationships.find(
      (relationship) => relationship.id === relationshipId,
    )?.personId;
    return (
      source?.people.find((person) => person.id === personId)?.name ?? t.unknown
    );
  };
  async function submit() {
    if (busy || !sequence || !relationshipIds.length) return;
    if (review && !review.enrolled.length) return;
    setBusy(true);
    setError("");
    const result = await send<Enrollment>({
      operation: "enroll",
      sequenceId: sequence.id,
      relationshipIds,
      dryRun: !review,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (!review) return setReview(result.result);
    crm.notify(
      t.enrollDone
        .replace("{people}", peopleCount(result.result.enrolled.length))
        .replace("{sequence}", sequence.name),
      "success",
    );
    onEnrolled();
  }
  return (
    <dialog
      ref={modal}
      className="dialog enroll-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <h2 id={titleId}>{t.enrollTitle}</h2>
      <form
        onKeyDown={submitOnSaveKey}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="muted">
          {t.enrollChosen.replace(
            "{people}",
            people.length > 3
              ? peopleCount(people.length)
              : people.map((person) => person.name).join(", "),
          )}
        </p>
        {!review ? (
          sequences.length ? (
            <label>
              {t.sequenceLabel}
              <select
                value={sequenceId}
                data-primary-field
                onChange={(event) => setSequenceId(event.target.value)}
              >
                {sequences.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {crm.product(item.productId)?.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p role="status">{t.enrollNoSequences}</p>
          )
        ) : (
          <>
            <section aria-labelledby={willId} className="enroll-summary">
              <h3 id={willId}>
                {t.enrollWill.replace(
                  "{count}",
                  String(review.enrolled.length),
                )}
              </h3>
              {review.enrolled.length ? (
                <ul>
                  {review.enrolled.map((row) => (
                    <li key={row.relationshipId}>
                      {nameOf(row.relationshipId)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{t.enrollNobody}</p>
              )}
            </section>
            {review.skipped.length > 0 && (
              <section aria-labelledby={skippedId} className="enroll-summary">
                <h3 id={skippedId}>
                  {t.enrollSkipped.replace(
                    "{count}",
                    String(review.skipped.length),
                  )}
                </h3>
                <ul>
                  {review.skipped.map((row) => (
                    <li key={row.relationshipId}>
                      {t.enrollSkipLine
                        .replace("{name}", nameOf(row.relationshipId))
                        .replace(
                          "{reason}",
                          t.outreachCopy.skipReasons[
                            row.reason as keyof typeof t.outreachCopy.skipReasons
                          ] ?? row.reason,
                        )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            data-modal-cancel
            disabled={busy}
            onClick={() => (review ? setReview(null) : onClose())}
          >
            {review ? t.goBack : t.cancel}
          </button>
          <button
            type="submit"
            className="primary"
            title={t.submitHint}
            disabled={
              busy ||
              !sequence ||
              !relationshipIds.length ||
              (!!review && !review.enrolled.length)
            }
          >
            {busy
              ? t.saving
              : review
                ? t.enrollConfirm.replace(
                    "{people}",
                    peopleCount(review.enrolled.length),
                  )
                : t.enrollReview}
          </button>
        </div>
      </form>
    </dialog>
  );
}
