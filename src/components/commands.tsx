"use client";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
export interface Command {
  id: string;
  title: string;
  shortcut: string;
  run: () => void;
  disabled?: boolean;
}
export function Commands({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    modal.current?.showModal();
  }, []);
  const filtered = commands.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <dialog
      ref={modal}
      className="dialog command-dialog"
      aria-labelledby="commands-title"
      onCancel={onClose}
    >
      <h2 id="commands-title">{t.commands}</h2>
      <input
        className="command-search"
        type="search"
        aria-label={t.commandSearch}
        placeholder={t.commandSearch}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const first = filtered.find((c) => !c.disabled);
            if (first) {
              onClose();
              first.run();
            }
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            modal.current
              ?.querySelector<HTMLButtonElement>(
                ".command-list button:not(:disabled)",
              )
              ?.focus();
          }
        }}
      />
      <div className="command-list">
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={c.disabled}
            onClick={() => {
              onClose();
              c.run();
            }}
          >
            {c.title}
            <kbd>{c.shortcut}</kbd>
          </button>
        ))}
        {!filtered.length && <p className="muted">{t.noCommands}</p>}
      </div>
      <div className="shortcut-map">
        <span>{t.commands}</span>
        <kbd>{t.keys.commands}</kbd>
        <span>{t.searchShortcut}</span>
        <kbd>{t.keys.search}</kbd>
        <span>{t.nextActionShortcut}</span>
        <kbd>{t.keys.movement}</kbd>
        <span>{t.createShortcut}</span>
        <kbd>{t.keys.schedule}</kbd>
        <span>{t.closeShortcut}</span>
        <kbd>{t.keys.close}</kbd>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          {t.close}
        </button>
      </div>
    </dialog>
  );
}
