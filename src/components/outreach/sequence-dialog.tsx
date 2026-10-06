"use client";
import t from "@crm/i18n/translations/en.json";
import { useId } from "react";
import { InlineRecordFrame } from "../records/inline-record-frame";
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
