import { shortcutFor } from "@crm/core/shortcuts";
import type { KeyboardEvent, MouseEvent } from "react";
import { keyInput } from "../keyboard-navigation";

export function rowKeys(handlers: { peek?: () => void; open?: () => void }) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const id = shortcutFor(keyInput(event), ["row"]);
    const handler =
      id === "peek" || id === "open"
        ? (handlers[id] ?? handlers.peek ?? handlers.open)
        : undefined;
    if (!handler) return;
    event.preventDefault();
    if (!event.repeat) handler();
  };
}

export const peekOnSpace = (peek: () => void) => rowKeys({ peek });
export const openOnEnter = (open: () => void) => rowKeys({ open });

export function peekLink(peek: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    peek();
  };
}

export function peekRow(peek: () => void) {
  return (event: MouseEvent<HTMLTableRowElement>) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (
      event.target instanceof Element &&
      event.target.closest("a,button,input,select,textarea")
    )
      return;
    if (window.getSelection()?.toString()) return;
    event.currentTarget
      .querySelector<HTMLElement>("[data-nav-record]")
      ?.focus();
    peek();
  };
}
