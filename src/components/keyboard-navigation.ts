"use client";
import { navigationIndex, shortcutFor } from "@crm/core/shortcuts";
import { useEffect, useRef } from "react";

export function useKeyboardNavigation(run: (command: string) => boolean) {
  const prefix = useRef(0);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      const target = event.target instanceof Element ? event.target : null;
      const command = shortcutFor({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing,
        isEditing: !!target?.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]",
        ),
        isModal: !!document.querySelector(
          "dialog[open], [role=dialog], [role=menu], [role=listbox]",
        ),
        prefix: Date.now() < prefix.current,
      });
      prefix.current = 0;
      if (!command) return;
      if (command === "prefix") {
        prefix.current = Date.now() + 900;
        event.preventDefault();
        return;
      }
      if (run(command)) event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
}

export function focusRecord(command: string) {
  const records = [
    ...document.querySelectorAll<HTMLElement>(
      "#records-panel [data-nav-record]",
    ),
  ].filter((element) => !element.hasAttribute("disabled"));
  const current = records.indexOf(document.activeElement as HTMLElement);
  const next = records[navigationIndex(records.length, current, command)];
  if (!next) return false;
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}
