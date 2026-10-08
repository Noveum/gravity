"use client";
import t from "@crm/i18n/translations/en.json";
import { useId } from "react";
import { InlineRecordFrame } from "../records/inline-record-frame";
import { RecordDialog } from "../records/record-dialog";
import { SequenceEditor } from "./sequence-editor";

export function SequenceDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  return (
    <InlineRecordFrame titleId={titleId} loading={false}>
      <h2 id={titleId}>{t.newSequence}</h2>
      <SequenceEditor label={t.newSequence} onClose={onClose} />
    </InlineRecordFrame>
  );
}

export function StopEnrollmentDialog({
  name,
  sequenceName,
  onClose,
  onSubmit,
}: {
  name: string;
  sequenceName: string;
  onClose: () => void;
  onSubmit: () => Promise<string | null>;
}) {
  return (
    <RecordDialog
      inline
      title={t.stopEnrollmentTitle.replace("{name}", name)}
      submitLabel={t.stop}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <p className="muted">
        {t.stopEnrollmentDetail
          .replace("{name}", name)
          .replace("{sequence}", sequenceName)}
      </p>
    </RecordDialog>
  );
}
