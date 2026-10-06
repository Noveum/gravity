"use client";
import {
  bindingKeys,
  bindingLabel,
  type Shortcut,
  type ShortcutId,
  type ShortcutScope,
  shortcutSections,
  shortcuts,
} from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import { Fragment, useRef, useState } from "react";
import { useModalLifecycle } from "./modal-lifecycle";

export function macPlatform() {
  return (
    typeof navigator !== "undefined" &&
    /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
  );
}

export function ShortcutKeys({
  shortcut,
  mac,
}: {
  shortcut: Shortcut;
  mac: boolean;
}) {
  return (
    <span className="shortcut-keys">
      <span className="sr-only">
        {shortcut.bindings
          .map((binding) => bindingLabel(binding, mac))
          .join(` ${t.shortcutOr} `)}
      </span>
      {shortcut.bindings.map((binding, index) => (
        <Fragment key={binding}>
          {index > 0 && (
            <span className="shortcut-or" aria-hidden>
              {t.shortcutOr}
            </span>
          )}
          <span className="shortcut-binding" aria-hidden>
            {bindingKeys(binding, mac).map((key, keyIndex) => (
              <kbd key={`${key}-${keyIndex.toString()}`}>{key}</kbd>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export function Shortcuts({
  onClose,
  unavailable = [],
  scopes,
  labelOverrides = {},
}: {
  onClose: () => void;
  unavailable?: readonly ShortcutId[];
  scopes?: readonly ShortcutScope[];
  labelOverrides?: Partial<Record<ShortcutId, string>>;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [mac] = useState(macPlatform);
  useModalLifecycle(modal);
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered = shortcuts.filter((shortcut) => {
    if (
      unavailable.includes(shortcut.id) ||
      (scopes && !scopes.includes(shortcut.scope))
    )
      return false;
    const text = [
      labelOverrides[shortcut.id] ?? shortcut.label,
      t.shortcutSections[shortcut.section],
      ...shortcut.bindings.map((binding) => bindingLabel(binding, mac)),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
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
        {shortcutSections.map((section) => {
          const entries = filtered.filter(
            (shortcut) => shortcut.section === section,
          );
          if (!entries.length) return null;
          return (
            <section
              key={section}
              aria-labelledby={`shortcut-section-${section}`}
            >
              <h3 id={`shortcut-section-${section}`}>
                {t.shortcutSections[section]}
              </h3>
              {entries.map((shortcut) => (
                <div
                  className="shortcut-row"
                  key={shortcut.id}
                  data-shortcut={shortcut.id}
                >
                  <span>{labelOverrides[shortcut.id] ?? shortcut.label}</span>
                  <ShortcutKeys shortcut={shortcut} mac={mac} />
                </div>
              ))}
            </section>
          );
        })}
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
