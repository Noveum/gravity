"use client";
import t from "@crm/i18n/translations/en.json";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { DropdownMenu, MenuItem } from "../ui/dropdown-menu";

export function RecordActions({
  busy,
  onEdit,
  onArchive,
  inlineEditing = false,
}: {
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  inlineEditing?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="record-actions">
      <DropdownMenu
        label={t.contactWorkspace.more}
        align="end"
        trigger={
          <button
            type="button"
            className="icon-button"
            aria-label={t.contactWorkspace.more}
            title={t.contactWorkspace.more}
          >
            <MoreHorizontal size={18} aria-hidden />
          </button>
        }
      >
        {!inlineEditing && (
          <MenuItem disabled={busy} onSelect={onEdit}>
            <Pencil size={13} aria-hidden />
            {t.edit}
          </MenuItem>
        )}
        <MenuItem disabled={busy} onSelect={() => setConfirming(true)}>
          <Archive size={13} aria-hidden />
          {t.archive}
        </MenuItem>
      </DropdownMenu>
      {confirming && (
        <fieldset
          className="inline-archive"
          aria-label={t.inlineEditing.archiveConfirm}
        >
          <p>{t.inlineEditing.archiveConfirm}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            {t.inlineEditing.cancelArchive}
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={onArchive}
          >
            {busy ? t.saving : t.inlineEditing.confirmArchive}
          </button>
        </fieldset>
      )}
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
