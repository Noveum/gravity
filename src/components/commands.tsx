"use client";
import t from "@crm/i18n/translations/en.json";
import { useId, useRef, useState } from "react";
import { useModalLifecycle } from "./modal-lifecycle";
import { ShortcutHint } from "./ui/shortcut-hint";
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
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState("");
  useModalLifecycle(modal);
  const filtered = commands.filter((command) =>
    query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .every((term) => command.title.toLowerCase().includes(term)),
  );
  const enabled = filtered.filter((command) => !command.disabled);
  const active =
    enabled.find((command) => command.id === activeId) || enabled[0];
  function execute(command: Command | undefined) {
    if (!command || command.disabled) return;
    onClose();
    command.run();
  }
  return (
    <dialog
      ref={modal}
      className="dialog command-dialog"
      aria-labelledby={`${listId}-title`}
      onCancel={onClose}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const key = event.key;
        if (key === "ArrowDown" || key === "ArrowUp") {
          event.preventDefault();
          const index = enabled.findIndex(
            (command) => command.id === active?.id,
          );
          const next =
            enabled[
              (index + (key === "ArrowDown" ? 1 : -1) + enabled.length) %
                enabled.length
            ];
          setActiveId(next?.id || "");
          search.current?.focus();
          document
            .getElementById(`${listId}-${next?.id}`)
            ?.scrollIntoView({ block: "nearest" });
        } else if (key === "Enter" && event.target === search.current) {
          event.preventDefault();
          execute(active);
        }
      }}
    >
      <h2 id={`${listId}-title`}>{t.commands}</h2>
      <input
        ref={search}
        className="command-search"
        type="search"
        role="combobox"
        aria-label={t.commandSearch}
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
        placeholder={t.commandSearch}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveId("");
        }}
      />
      <div
        id={listId}
        className="command-list"
        role="listbox"
        aria-label={t.commands}
      >
        {filtered.map((command) => (
          <button
            id={`${listId}-${command.id}`}
            key={command.id}
            type="button"
            role="option"
            aria-selected={active?.id === command.id}
            tabIndex={-1}
            disabled={command.disabled}
            onPointerMove={() => {
              if (!command.disabled) setActiveId(command.id);
            }}
            onClick={() => execute(command)}
          >
            {command.title}
            <ShortcutHint keys={command.shortcut} />
          </button>
        ))}
      </div>
      {!filtered.length && (
        <p role="status" className="muted">
          {t.noCommands}
        </p>
      )}
      <p className="muted command-hint">{t.commandNavigation}</p>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          {t.close}
        </button>
      </div>
    </dialog>
  );
}
