"use client";
import t from "@crm/i18n/translations/en.json";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";

export function RecordActions({
  busy,
  onEdit,
  onArchive,
}: {
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="record-actions">
      <button
        type="button"
        aria-keyshortcuts="E"
        title={`${t.edit} (E)`}
        disabled={busy}
        onClick={onEdit}
      >
        <Pencil size={13} aria-hidden />
        {t.edit}
      </button>
      <button
        type="button"
        className="ghost"
        disabled={busy}
        onClick={onArchive}
      >
        <Archive size={13} aria-hidden />
        {t.archive}
      </button>
    </div>
  );
}

export function ArchivedNotice({
  note,
  busy,
  onRestore,
}: {
  note: string;
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <div className="callout archived-notice" role="status">
      <p>{note}</p>
      <button type="button" disabled={busy} onClick={onRestore}>
        <ArchiveRestore size={13} aria-hidden />
        {t.restore}
      </button>
    </div>
  );
}
