"use client";
import t from "@crm/i18n/translations/en.json";
import { Building2, ListChecks, type LucideIcon, User } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useModalLifecycle } from "./modal-lifecycle";

export interface Command {
  id: string;
  title: string;
  shortcut: string;
  run: () => void;
  disabled?: boolean;
}
export type RecordKind = "person" | "company" | "action";
export interface PaletteRecord {
  id: string;
  kind: RecordKind;
  title: string;
  detail: string;
  run: () => void;
}
interface Item {
  id: string;
  title: string;
  detail?: string;
  shortcut?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  run: () => void;
}

const recordIcons: Record<RecordKind, LucideIcon> = {
  person: User,
  company: Building2,
  action: ListChecks,
};
const recordLimit = 5;

function termsOf(query: string) {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}
const matches = (terms: string[], text: string) =>
  terms.every((term) => text.toLowerCase().includes(term));

const kinds: RecordKind[] = ["person", "company", "action"];

export function matchingRecords(records: PaletteRecord[], query: string) {
  const terms = termsOf(query);
  if (!terms.length) return [];
  const found = kinds.flatMap((kind) =>
    records
      .filter(
        (record) =>
          record.kind === kind &&
          matches(terms, `${record.title} ${record.detail}`),
      )
      .slice(0, recordLimit),
  );
  const byTitle = (record: PaletteRecord) =>
    matches(terms, record.title) ? 0 : 1;
  return found.sort((a, b) => byTitle(a) - byTitle(b));
}

export function Commands({
  commands,
  records = [],
  onClose,
}: {
  commands: Command[];
  records?: PaletteRecord[];
  onClose: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState("");
  useModalLifecycle(modal);
  const terms = termsOf(query);
  const recordItems: Item[] = matchingRecords(records, query).map((record) => ({
    id: `${record.kind}-${record.id}`,
    title: record.title,
    detail: record.detail,
    icon: recordIcons[record.kind],
    run: record.run,
  }));
  const commandItems: Item[] = commands.filter((command) =>
    matches(terms, command.title),
  );
  const groups = [
    { id: "records", title: t.paletteRecords, items: recordItems },
    { id: "commands", title: t.paletteCommands, items: commandItems },
  ].filter((group) => group.items.length);
  const enabled = groups
    .flatMap((group) => group.items)
    .filter((item) => !item.disabled);
  const active = enabled.find((item) => item.id === activeId) || enabled[0];
  function execute(item: Item | undefined) {
    if (!item || item.disabled) return;
    onClose();
    item.run();
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
          const index = enabled.findIndex((item) => item.id === active?.id);
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
        placeholder={t.paletteSearch}
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
        {groups.map((group) => (
          <fieldset
            key={group.id}
            aria-labelledby={`${listId}-${group.id}-label`}
            className="command-group"
          >
            <div
              id={`${listId}-${group.id}-label`}
              className="command-group-title"
              role="presentation"
            >
              {group.title}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  id={`${listId}-${item.id}`}
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active?.id === item.id}
                  tabIndex={-1}
                  disabled={item.disabled}
                  onPointerMove={() => {
                    if (!item.disabled) setActiveId(item.id);
                  }}
                  onClick={() => execute(item)}
                >
                  {Icon && (
                    <Icon size={14} aria-hidden className="command-icon" />
                  )}
                  <span className="command-title">{item.title}</span>
                  {item.detail && (
                    <span className="command-detail">{item.detail}</span>
                  )}
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </button>
              );
            })}
          </fieldset>
        ))}
      </div>
      {!groups.length && (
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
