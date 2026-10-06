"use client";
import t from "@crm/i18n/translations/en.json";
import { useId } from "react";
import { RecordDialog, text } from "../records/record-dialog";

export function MarkSentDialog({
  name,
  onClose,
  onSubmit,
}: {
  name: string;
  onClose: () => void;
  onSubmit: (link: string) => Promise<string | null>;
}) {
  const hint = useId();
  return (
    <RecordDialog
      inline
      title={t.markSentTitle}
      submitLabel={t.markSentSubmit}
      onClose={onClose}
      onSubmit={(fields) => onSubmit(text(fields, "link"))}
    >
      <p className="muted">
        <strong>{name}</strong> · {t.markSentDetail}
      </p>
      <label>
        {t.markSentLink}
        <input
          name="link"
          maxLength={500}
          aria-describedby={hint}
          data-primary-field
        />
      </label>
      <small id={hint} className="field-hint muted">
        {t.markSentLinkHint}
      </small>
    </RecordDialog>
  );
}

export function SkipDialog({
  name,
  onClose,
  onSubmit,
}: {
  name: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<string | null>;
}) {
  const hint = useId();
  return (
    <RecordDialog
      inline
      title={t.skipTitle}
      submitLabel={t.skipSubmit}
      onClose={onClose}
      onSubmit={(fields) => onSubmit(text(fields, "reason"))}
    >
      <p className="muted">
        <strong>{name}</strong>
      </p>
      <label>
        {t.skipReason}
        <input
          name="reason"
          required
          maxLength={500}
          aria-describedby={hint}
          data-primary-field
        />
      </label>
      <small id={hint} className="field-hint muted">
        {t.skipReasonHint}
      </small>
    </RecordDialog>
  );
}
