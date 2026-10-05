import { shortcutFor } from "@crm/core/shortcuts";
import type { KeyboardEvent } from "react";
import { keyInput } from "../keyboard-navigation";

export function rowKeys(handlers: { peek?: () => void; open?: () => void }) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const id = shortcutFor(keyInput(event), ["row"]);
    const handler = id === "peek" || id === "open" ? handlers[id] : undefined;
    if (!handler) return;
    event.preventDefault();
    if (!event.repeat) handler();
  };
}

export const peekOnSpace = (peek: () => void) => rowKeys({ peek });
export const openOnEnter = (open: () => void) => rowKeys({ open });
