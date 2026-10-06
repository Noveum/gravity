"use client";
import t from "@crm/i18n/translations/en.json";
import { useId, useRef } from "react";
import { useModalLifecycle } from "../modal-lifecycle";
import { SequenceEditor } from "./sequence-editor";

export function SequenceDialog({ onClose }: { onClose: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const titleId = useId();
  useModalLifecycle(modal);
  return (
    <dialog
      ref={modal}
      className="dialog sequence-create-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (busy.current) event.preventDefault();
        else onClose();
      }}
    >
      <h2 id={titleId}>{t.newSequence}</h2>
      <SequenceEditor
        label={t.newSequence}
        onClose={onClose}
        onBusyChange={(value) => {
          busy.current = value;
        }}
      />
    </dialog>
  );
}
