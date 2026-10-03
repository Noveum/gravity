"use client";
import { navigationKeys } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import { useRef, useState } from "react";
import { label } from "./client-api";
import { useModalLifecycle } from "./modal-lifecycle";

const shortcuts = [
  ...Object.values(navigationKeys).map((view) => ({
    label: label(view),
    keys: t.keys[view],
    section: t.keyboardNavigation,
  })),
  ...[
    [t.commands, t.keys.commands],
    [t.keyboardHelp, "?"],
    [t.searchShortcut, "/"],
    [t.keyboardRecords, "J / K · ↓ / ↑ · Home / End"],
    [t.keyboardOpen, "Enter"],
    [t.keyboardCreate, "C"],
    [t.scheduleAction, "N"],
    [t.workspace, "O"],
    [t.product, "P"],
    [t.keyboardSubmit, "⌘ / Ctrl Enter"],
  ].map(([name, keys]) => ({ label: name, keys, section: t.keyboardGeneral })),
  ...[
    [t.expandInspector, "E"],
    [t.keyboardListFocus, "H"],
    [t.keyboardDetailFocus, "L"],
    [t.timeline, "1"],
    [t.evidence, "2"],
    [t.draft, "3"],
    [t.backToRecord, "B"],
    [t.closeInspector, "Esc"],
  ].map(([name, keys]) => ({ label: name, keys, section: t.recordDetails })),
];
export function Shortcuts({ onClose }: { onClose: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useModalLifecycle(modal);
  const filtered = shortcuts.filter((shortcut) =>
    `${shortcut.label} ${shortcut.keys} ${shortcut.section}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <dialog
      ref={modal}
      className="dialog shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      onCancel={onClose}
    >
      <h2 id="shortcuts-title">{t.keyboardHelp}</h2>
      <p className="muted">{t.keyboardSafety}</p>
      <input
        type="search"
        aria-label={t.shortcutSearch}
        placeholder={t.shortcutSearch}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="shortcut-groups">
        {[t.keyboardNavigation, t.keyboardGeneral, t.recordDetails].map(
          (section) => (
            <section key={section}>
              {filtered.some((shortcut) => shortcut.section === section) && (
                <h3>{section}</h3>
              )}
              {filtered
                .filter((shortcut) => shortcut.section === section)
                .map((shortcut) => (
                  <div className="shortcut-row" key={shortcut.label}>
                    <span>{shortcut.label}</span>
                    <kbd>{shortcut.keys}</kbd>
                  </div>
                ))}
            </section>
          ),
        )}
        {!filtered.length && <p role="status">{t.noCommands}</p>}
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          {t.close}
        </button>
      </div>
    </dialog>
  );
}
