export const navigationKeys = {
  v: "overview",
  a: "actions",
  p: "people",
  c: "companies",
  s: "sequences",
  m: "meetings",
  o: "opportunities",
  f: "materials",
  i: "integrations",
  x: "assistants",
  t: "settings",
  r: "outreach",
} as const;
export type View = (typeof navigationKeys)[keyof typeof navigationKeys];
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
  defaultPrevented?: boolean;
  repeat?: boolean;
}
export function shortcutFor(input: ShortcutInput): string | null {
  if (
    input.defaultPrevented ||
    input.isComposing ||
    input.isModal ||
    input.altKey ||
    typeof input.key !== "string"
  )
    return null;
  const key = input.key.toLowerCase();
  if ((input.metaKey || input.ctrlKey) && !input.shiftKey && key === "k")
    return "commands";
  if (input.metaKey || input.ctrlKey) return null;
  if (key === "escape") return "close";
  if (input.isEditing) return null;
  if (key === "?") return "help";
  if (input.shiftKey) {
    if (input.repeat || input.prefix) return null;
    if (key === "p") return "createProduct";
    if (key === "o") return "createOrganization";
    return null;
  }
  if (input.repeat && ["g", "c", "n"].includes(key)) return null;
  if (input.prefix)
    return navigationKeys[key as keyof typeof navigationKeys] || null;
  if (key === "/") return "search";
  if (key === "[") return "sidebar";
  if (key === "c") return "create";
  if (key === "n") return "schedule";
  if (key === "j" || key === "arrowdown") return "next";
  if (key === "k" || key === "arrowup") return "previous";
  if (key === "home") return "first";
  if (key === "end") return "last";
  if (key === "g") return "prefix";
  if (key === "o") return "organization";
  if (key === "p") return "product";
  if (key === "e") return "expand";
  if (key === "h") return "listFocus";
  if (key === "l") return "detailFocus";
  if (key === "b") return "back";
  if (["1", "2", "3"].includes(key))
    return ["timeline", "evidence", "draft"][Number(key) - 1];
  return null;
}
export function navigationIndex(
  length: number,
  current: number,
  command: string,
) {
  if (!length) return -1;
  if (command === "first") return 0;
  if (command === "last") return length - 1;
  if (current < 0) return command === "previous" ? length - 1 : 0;
  return Math.max(
    0,
    Math.min(length - 1, current + (command === "previous" ? -1 : 1)),
  );
}
