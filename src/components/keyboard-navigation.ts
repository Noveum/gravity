"use client";
import {
  isModifierKey,
  type KeyStroke,
  type Movement,
  matchShortcut,
  navigationIndex,
  type ShortcutId,
  type ShortcutScope,
  sequenceTimeout,
  startsSequence,
  strokeFor,
} from "@crm/core/shortcuts";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
} from "react";

const keyboardLayers =
  "dialog[open], [role=dialog], [role=alertdialog], [role=menu], [role=listbox]";
const textTypes = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "range",
  "color",
  "image",
]);

export function isEditable(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return !textTypes.has(target.type);
  return !!target.closest(
    "textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]",
  );
}

export function keyInput(event: ReactKeyboardEvent) {
  return {
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    isComposing: event.nativeEvent.isComposing,
  };
}

export function keyboardOwnedByLayer() {
  return !!document.querySelector(keyboardLayers);
}

export type DispatchedShortcut = Exclude<ShortcutId, "peek" | "open" | "save">;

export function useKeyboardNavigation(
  run: (id: DispatchedShortcut, event: KeyboardEvent) => boolean,
  scopes: () => readonly ShortcutScope[] = () => ["global", "list"],
) {
  const latest = useRef({ run, scopes });
  useEffect(() => {
    latest.current = { run, scopes };
  });
  useEffect(() => {
    let buffer: (KeyStroke & { at: number })[] = [];
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        typeof event.key !== "string" ||
        !event.key ||
        isModifierKey(event.key)
      )
        return;
      if (keyboardOwnedByLayer()) {
        buffer = [];
        return;
      }
      const now = Date.now();
      const context = {
        scopes: latest.current.scopes(),
        editing: isEditable(event.target),
        composing: event.isComposing,
        repeat: event.repeat,
      };
      const strokes = [
        ...(context.editing
          ? []
          : buffer.filter((stroke) => now - stroke.at <= sequenceTimeout)),
        { ...strokeFor(event), at: now },
      ].slice(-3);
      const match = matchShortcut(strokes, context);
      if (!match) {
        buffer = strokes;
        if (
          strokes.some((_, index) =>
            startsSequence(strokes.slice(index), context),
          )
        )
          event.preventDefault();
        return;
      }
      buffer = [];
      if (latest.current.run(match.id as DispatchedShortcut, event))
        event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
}

export function navigableRecords() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      "#records-panel [data-nav-record]",
    ),
  ].filter((element) => !element.hasAttribute("disabled"));
}

export function focusedRecord() {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.hasAttribute("data-nav-record")
    ? active
    : null;
}

export function focusRecord(command: Movement) {
  const records = navigableRecords();
  const current = records.indexOf(document.activeElement as HTMLElement);
  const next = records[navigationIndex(records.length, current, command)];
  if (!next) return false;
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}
