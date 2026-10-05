import type { KeyboardEvent } from "react";

const plain = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

export function peekOnSpace(peek: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== " " || !plain(event) || event.nativeEvent.isComposing)
      return;
    event.preventDefault();
    if (!event.repeat) peek();
  };
}

export function openOnEnter(open: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || !plain(event) || event.nativeEvent.isComposing)
      return;
    event.preventDefault();
    if (!event.repeat) open();
  };
}
