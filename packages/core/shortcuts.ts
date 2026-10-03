// Pure routing makes typing, composition and browser shortcuts explicit and testable.
export interface ShortcutInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  isEditing: boolean;
  isModal: boolean;
  prefix: boolean;
}
export function shortcutFor(input: ShortcutInput): string | null {
  if (input.isComposing || input.isModal || input.altKey) return null;
  const key = input.key.toLowerCase();
  if ((input.metaKey || input.ctrlKey) && key === "k") return "commands";
  if (input.isEditing || input.metaKey || input.ctrlKey) return null;
  if (key === "escape") return "close";
  if (key === "?") return "commands";
  if (input.shiftKey) return null;
  if (key === "/") return "search";
  if (key === "n") return "schedule";
  if (key === "j" || key === "arrowdown") return "next";
  if (key === "k" || key === "arrowup") return "previous";
  if (input.prefix)
    return (
      (
        {
          a: "actions",
          p: "people",
          c: "companies",
          s: "sequences",
          m: "meetings",
          o: "opportunities",
          f: "materials",
        } as Record<string, string>
      )[key] || null
    );
  if (key === "g") return "prefix";
  return null;
}
