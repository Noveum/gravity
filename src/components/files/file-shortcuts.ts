export type FileShortcut =
  | "all"
  | "copy"
  | "cut"
  | "paste"
  | "open"
  | "delete"
  | "clear"
  | "down"
  | "up";

export function isFileInput(target: EventTarget | null): boolean {
  return (
    (target instanceof HTMLInputElement &&
      !["checkbox", "radio", "button"].includes(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function fileShortcut(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey?: boolean;
}): FileShortcut | null {
  if (event.altKey) return null;
  if (event.metaKey && event.key === "Backspace") return "delete";
  if (event.metaKey || event.ctrlKey) {
    const commands: Readonly<Record<string, FileShortcut>> = {
      a: "all",
      c: "copy",
      x: "cut",
      v: "paste",
    };
    return commands[event.key.toLowerCase()] ?? null;
  }
  const commands: Readonly<Record<string, FileShortcut>> = {
    Enter: "open",
    Delete: "delete",
    Escape: "clear",
    ArrowDown: "down",
    ArrowUp: "up",
  };
  return commands[event.key] ?? null;
}
