import t from "../i18n/translations/en.json";

export const views = [
  "actions",
  "people",
  "companies",
  "sequences",
  "meetings",
  "opportunities",
  "materials",
  "integrations",
  "settings",
  "outreach",
] as const;
export type View = (typeof views)[number];

export type ShortcutScope =
  | "global"
  | "list"
  | "actions"
  | "detail"
  | "peek"
  | "record"
  | "board"
  | "pipeline"
  | "outreach"
  | "row"
  | "dialog";
export type ShortcutSection =
  | "navigation"
  | "general"
  | "lists"
  | "actions"
  | "outreach"
  | "details"
  | "dialogs";

interface Definition {
  bindings: readonly string[];
  scope: ShortcutScope;
  section: ShortcutSection;
  label: string;
  repeatable?: boolean;
  typing?: "pause";
  view?: View;
}

const labels = t.shortcutLabels;
const goTo = (key: string, view: View): Definition => ({
  bindings: [`g ${key}`],
  scope: "global",
  section: "navigation",
  label: t[view],
  view,
});
const define = (
  bindings: readonly string[],
  scope: ShortcutScope,
  section: ShortcutSection,
  label: string,
  options: Pick<Definition, "repeatable" | "typing"> = {},
): Definition => ({ bindings, scope, section, label, ...options });
const repeatable = { repeatable: true };

const definitions = {
  "go-actions": goTo("a", "actions"),
  "go-meetings": goTo("m", "meetings"),
  "go-outreach": goTo("u", "outreach"),
  "go-sequences": goTo("s", "sequences"),
  "go-people": goTo("p", "people"),
  "go-companies": goTo("c", "companies"),
  "go-opportunities": goTo("o", "opportunities"),
  "go-materials": goTo("f", "materials"),
  "go-integrations": goTo("i", "integrations"),
  "go-settings": goTo("t", "settings"),
  palette: define(["mod+k"], "global", "general", labels.palette),
  help: define(["?"], "global", "general", labels.help),
  search: define(["/"], "global", "general", labels.search),
  create: define(["c"], "global", "general", labels.create),
  schedule: define(["n"], "global", "general", labels.schedule),
  sidebar: define(["["], "global", "general", labels.sidebar),
  theme: define(["mod+shift+l"], "global", "general", labels.theme),
  organization: define(["o"], "global", "general", labels.organization),
  product: define(["p"], "global", "general", labels.product),
  back: define(["escape"], "global", "general", labels.back),
  next: define(["j", "arrowdown"], "list", "lists", labels.next, repeatable),
  previous: define(
    ["k", "arrowup"],
    "list",
    "lists",
    labels.previous,
    repeatable,
  ),
  first: define(["home"], "list", "lists", labels.first),
  last: define(["end"], "list", "lists", labels.last),
  peek: define(["space"], "row", "lists", labels.peek),
  open: define(["enter"], "row", "lists", labels.open),
  select: define(["x"], "list", "lists", labels.select),
  "extend-next": define(
    ["shift+j", "shift+arrowdown"],
    "list",
    "lists",
    labels.extendNext,
    repeatable,
  ),
  "extend-previous": define(
    ["shift+k", "shift+arrowup"],
    "list",
    "lists",
    labels.extendPrevious,
    repeatable,
  ),
  "move-next": define(["shift+arrowright"], "board", "lists", labels.moveNext),
  "move-previous": define(
    ["shift+arrowleft"],
    "board",
    "lists",
    labels.movePrevious,
  ),
  "move-to": define(["m"], "pipeline", "lists", labels.moveTo),
  done: define(["d"], "actions", "actions", labels.done),
  snooze: define(["s"], "actions", "actions", labels.snooze),
  assign: define(["a"], "actions", "actions", labels.assign),
  undo: define(["mod+z"], "actions", "actions", labels.undo, {
    typing: "pause",
  }),
  "touch-approve": define(["a"], "outreach", "outreach", labels.touchApprove),
  "touch-sent": define(["d"], "outreach", "outreach", labels.touchSent),
  "touch-snooze": define(["s"], "outreach", "outreach", labels.touchSnooze),
  "touch-skip": define(["shift+s"], "outreach", "outreach", labels.touchSkip),
  "touch-edit": define(["e"], "outreach", "outreach", labels.touchEdit),
  "touch-undo": define(["mod+z"], "outreach", "outreach", labels.touchUndo, {
    typing: "pause",
  }),
  expand: define(["e"], "peek", "details", labels.expand),
  "list-focus": define(["h"], "peek", "details", labels.listFocus),
  "detail-focus": define(["l"], "peek", "details", labels.detailFocus),
  timeline: define(["1"], "detail", "details", labels.timeline),
  evidence: define(["2"], "detail", "details", labels.evidence),
  draft: define(["3"], "detail", "details", labels.draft),
  "previous-record": define(["b"], "peek", "details", labels.previousRecord),
  edit: define(["e"], "record", "details", labels.edit),
  save: define(["e", "mod+enter"], "dialog", "dialogs", labels.save),
} satisfies Record<string, Definition>;

export type ShortcutId = keyof typeof definitions;
export interface Shortcut extends Definition {
  id: ShortcutId;
}
export const shortcuts: readonly Shortcut[] = (
  Object.keys(definitions) as ShortcutId[]
).map((id) => ({ id, ...definitions[id] }));
export const shortcutSections: readonly ShortcutSection[] = [
  "navigation",
  "general",
  "lists",
  "actions",
  "outreach",
  "details",
  "dialogs",
];
export const sequenceTimeout = 900;

export function shortcut(id: ShortcutId): Shortcut {
  return { id, ...definitions[id] };
}

export interface KeyStroke {
  key: string;
  mod: boolean;
  alt: boolean;
  shift: boolean;
}
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}
export interface ShortcutContext {
  scopes: readonly ShortcutScope[];
  editing: boolean;
  composing: boolean;
  repeat?: boolean;
}

const aliases: Record<string, string> = { space: " ", esc: "escape" };
const modifierKeys = new Set(["shift", "control", "alt", "meta", "os"]);

export function isModifierKey(key: string) {
  return modifierKeys.has(key.toLowerCase());
}

function parseStroke(token: string): KeyStroke {
  const parts = token.split("+");
  const key = parts.at(-1)?.toLowerCase() ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  return {
    key: aliases[key] ?? key,
    mod: modifiers.has("mod"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift"),
  };
}

export function parseBinding(binding: string): KeyStroke[] {
  return binding.trim().split(/\s+/).map(parseStroke);
}

export function strokeFor(event: KeyEventLike): KeyStroke {
  const key = event.key.toLowerCase();
  return {
    key: aliases[key] ?? key,
    mod: event.metaKey || event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

const shiftNeutral = (key: string) =>
  key.length === 1 && !/[a-z0-9 ]/.test(key);

function strokeMatches(expected: KeyStroke, actual: KeyStroke) {
  return (
    expected.key === actual.key &&
    expected.mod === actual.mod &&
    expected.alt === actual.alt &&
    (shiftNeutral(expected.key) || expected.shift === actual.shift)
  );
}

const parsed = shortcuts.flatMap((entry) =>
  entry.bindings.map((binding) => ({
    entry,
    strokes: parseBinding(binding),
  })),
);

const allowedWhileEditing = (entry: Shortcut, strokes: readonly KeyStroke[]) =>
  entry.typing !== "pause" &&
  strokes.length === 1 &&
  !!strokes[0] &&
  (strokes[0].mod || strokes[0].key === "escape");

export function matchShortcut(
  strokes: readonly KeyStroke[],
  context: ShortcutContext,
): Shortcut | null {
  const last = strokes.at(-1);
  if (!last || context.composing || last.alt) return null;
  let best: { entry: Shortcut; length: number } | null = null;
  for (const candidate of parsed) {
    const { entry } = candidate;
    const length = candidate.strokes.length;
    if (
      !context.scopes.includes(entry.scope) ||
      (context.editing && !allowedWhileEditing(entry, candidate.strokes)) ||
      (context.repeat && !entry.repeatable) ||
      length > strokes.length
    )
      continue;
    const tail = strokes.slice(strokes.length - length);
    const matches = candidate.strokes.every((stroke, index) => {
      const actual = tail[index];
      return !!actual && strokeMatches(stroke, actual);
    });
    if (matches && (!best || length > best.length)) best = { entry, length };
  }
  return best?.entry ?? null;
}

export function startsSequence(
  strokes: readonly KeyStroke[],
  context: ShortcutContext,
) {
  if (context.editing || context.composing || !strokes.length) return false;
  return parsed.some(
    ({ entry, strokes: expected }) =>
      context.scopes.includes(entry.scope) &&
      expected.length > strokes.length &&
      strokes.every((stroke, index) => {
        const step = expected[index];
        return !!step && strokeMatches(step, stroke);
      }),
  );
}

export function shortcutFor(
  event: KeyEventLike & { isComposing?: boolean; repeat?: boolean },
  scopes: readonly ShortcutScope[],
  editing = false,
): ShortcutId | null {
  if (typeof event.key !== "string" || isModifierKey(event.key)) return null;
  return (
    matchShortcut([strokeFor(event)], {
      scopes,
      editing,
      composing: !!event.isComposing,
      repeat: !!event.repeat,
    })?.id ?? null
  );
}

const keyNames: Record<string, string> = {
  " ": t.keyNames.space,
  escape: t.keyNames.escape,
  enter: t.keyNames.enter,
  arrowdown: "\u2193",
  arrowup: "\u2191",
  arrowright: "\u2192",
  arrowleft: "\u2190",
  home: t.keyNames.home,
  end: t.keyNames.end,
};

export function bindingKeys(binding: string, mac: boolean): string[] {
  return parseBinding(binding).flatMap((stroke) => [
    ...(stroke.mod ? [mac ? "\u2318" : t.keyNames.ctrl] : []),
    ...(stroke.shift ? [t.keyNames.shift] : []),
    keyNames[stroke.key] ?? stroke.key.toUpperCase(),
  ]);
}

export function bindingLabel(binding: string, mac: boolean) {
  return bindingKeys(binding, mac).join(" ");
}

export type Movement = "next" | "previous" | "first" | "last";

export function navigationIndex(
  length: number,
  current: number,
  command: Movement,
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

export interface SelectionState {
  selected: readonly string[];
  anchor: string;
  base: readonly string[];
}

export const emptySelection: SelectionState = {
  selected: [],
  anchor: "",
  base: [],
};

export function toggleSelection(
  state: SelectionState,
  id: string,
): SelectionState {
  return {
    selected: state.selected.includes(id)
      ? state.selected.filter((item) => item !== id)
      : [...state.selected, id],
    anchor: "",
    base: [],
  };
}

export function extendSelection(
  order: readonly string[],
  state: SelectionState,
  from: string,
  to: string,
): SelectionState {
  const anchor = state.anchor || from;
  const base = state.anchor ? state.base : state.selected;
  const start = order.indexOf(anchor);
  const end = order.indexOf(to);
  if (start < 0 || end < 0) return state;
  const range = order.slice(Math.min(start, end), Math.max(start, end) + 1);
  return {
    selected: order.filter((id) => base.includes(id) || range.includes(id)),
    anchor,
    base,
  };
}
