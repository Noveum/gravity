import { describe, expect, test } from "vitest";
import {
  bindingLabel,
  emptySelection,
  extendSelection,
  type KeyStroke,
  matchShortcut,
  parseBinding,
  type ShortcutScope,
  shortcutFor,
  shortcuts,
  startsSequence,
  toggleSelection,
} from "../packages/core/shortcuts";

const stroke = (key: string, extra: Partial<KeyStroke> = {}): KeyStroke => ({
  key,
  mod: false,
  alt: false,
  shift: false,
  ...extra,
});
const everywhere: ShortcutScope[] = [
  "global",
  "list",
  "actions",
  "detail",
  "peek",
];
const match = (
  strokes: KeyStroke[],
  extra: Partial<Parameters<typeof matchShortcut>[1]> = {},
) =>
  matchShortcut(strokes, {
    scopes: everywhere,
    editing: false,
    composing: false,
    ...extra,
  })?.id ?? null;
const key = (
  value: string,
  extra: Partial<Parameters<typeof shortcutFor>[0]> = {},
) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

describe("shortcut registry", () => {
  test("every binding parses, ids are unique and no two entries share a binding in one scope", () => {
    expect(new Set(shortcuts.map((entry) => entry.id)).size).toBe(
      shortcuts.length,
    );
    const seen = new Map<string, string>();
    for (const entry of shortcuts)
      for (const binding of entry.bindings) {
        expect(parseBinding(binding).every((part) => part.key)).toBe(true);
        const slot = `${entry.scope}:${binding}`;
        expect(seen.get(slot), slot).toBeUndefined();
        seen.set(slot, entry.id);
      }
  });
  test("each registry binding resolves to its own entry in its scope", () => {
    for (const entry of shortcuts)
      for (const binding of entry.bindings)
        expect(
          matchShortcut(parseBinding(binding), {
            scopes: [entry.scope],
            editing: false,
            composing: false,
          })?.id,
        ).toBe(entry.id);
  });
  test("go-to chords beat the single keys they start with", () => {
    expect(match([stroke("g"), stroke("a")])).toBe("go-actions");
    expect(match([stroke("g"), stroke("s")])).toBe("go-sequences");
    expect(match([stroke("g"), stroke("u")])).toBe("go-outreach");
    expect(match([stroke("a")])).toBe("assign");
    expect(match([stroke("s")])).toBe("snooze");
    expect(match([stroke("g")])).toBeNull();
    expect(
      startsSequence([stroke("g")], {
        scopes: ["global"],
        editing: false,
        composing: false,
      }),
    ).toBe(true);
  });
  test("row verbs only exist on the actions list and detail keys only with a detail open", () => {
    const list: ShortcutScope[] = ["global", "list"];
    expect(shortcutFor(key("d"), list)).toBeNull();
    expect(shortcutFor(key("d"), [...list, "actions"])).toBe("done");
    expect(shortcutFor(key("e"), list)).toBeNull();
    expect(shortcutFor(key("e"), ["peek"])).toBe("expand");
    expect(shortcutFor(key("e"), ["dialog"])).toBe("save");
    expect(shortcutFor(key("3"), ["detail"])).toBe("draft");
  });
});

describe("keyboard safety", () => {
  test("typing and composing pause every single key, and Cmd combinations still work", () => {
    for (const value of ["n", "j", "g", "/", "?", "x", "d", "[", "c"]) {
      expect(shortcutFor(key(value), everywhere, true)).toBeNull();
      expect(
        shortcutFor(key(value, { isComposing: true }), everywhere),
      ).toBeNull();
    }
    expect(shortcutFor(key("k", { metaKey: true }), everywhere, true)).toBe(
      "palette",
    );
    expect(
      shortcutFor(
        key("L", { metaKey: true, shiftKey: true }),
        everywhere,
        true,
      ),
    ).toBe("theme");
    expect(shortcutFor(key("Escape"), everywhere, true)).toBe("back");
    expect(
      shortcutFor(key("z", { metaKey: true }), everywhere, true),
    ).toBeNull();
    expect(shortcutFor(key("z", { metaKey: true }), everywhere)).toBe("undo");
    expect(
      shortcutFor(key("k", { metaKey: true, isComposing: true }), everywhere),
    ).toBeNull();
  });
  test("modifiers are exact: Shift extends, Alt never matches, and browser shortcuts pass through", () => {
    expect(shortcutFor(key("J", { shiftKey: true }), everywhere)).toBe(
      "extend-next",
    );
    expect(shortcutFor(key("ArrowUp", { shiftKey: true }), everywhere)).toBe(
      "extend-previous",
    );
    expect(shortcutFor(key("D", { shiftKey: true }), everywhere)).toBeNull();
    expect(shortcutFor(key("?", { shiftKey: true }), everywhere)).toBe("help");
    expect(shortcutFor(key("j", { altKey: true }), everywhere)).toBeNull();
    expect(shortcutFor(key("l", { metaKey: true }), everywhere)).toBeNull();
    expect(shortcutFor(key("n", { ctrlKey: true }), everywhere)).toBeNull();
    expect(
      shortcutFor(key("k", { metaKey: true, shiftKey: true }), everywhere),
    ).toBeNull();
    expect(shortcutFor(key("Enter", { metaKey: true }), everywhere)).toBeNull();
    expect(shortcutFor(key("Enter", { metaKey: true }), ["dialog"])).toBe(
      "save",
    );
    expect(shortcutFor(key("e"), ["dialog"], true)).toBeNull();
    expect(shortcutFor(key("Enter", { ctrlKey: true }), ["dialog"], true)).toBe(
      "save",
    );
  });
  test("held keys repeat movement but never create, select or change records", () => {
    for (const value of ["c", "n", "x", "d", "s", "a", "?"])
      expect(shortcutFor(key(value, { repeat: true }), everywhere)).toBeNull();
    expect(shortcutFor(key("j", { repeat: true }), everywhere)).toBe("next");
    expect(
      shortcutFor(key("J", { shiftKey: true, repeat: true }), everywhere),
    ).toBe("extend-next");
  });
  test("labels show the platform modifier", () => {
    expect(bindingLabel("mod+k", true)).toBe("⌘ K");
    expect(bindingLabel("mod+k", false)).toBe("Ctrl K");
    expect(bindingLabel("mod+shift+l", true)).toBe("⌘ Shift L");
    expect(bindingLabel("g a", true)).toBe("G A");
    expect(bindingLabel("space", true)).toBe("Space");
    expect(bindingLabel("shift+arrowdown", true)).toBe("Shift ↓");
  });
});

describe("selection", () => {
  const order = ["a", "b", "c", "d", "e"];
  test("X toggles and Shift extends from an anchor, shrinking when it turns back", () => {
    let state = toggleSelection(emptySelection, "b");
    expect(state.selected).toEqual(["b"]);
    state = extendSelection(order, state, "b", "c");
    expect(state.selected).toEqual(["b", "c"]);
    state = extendSelection(order, state, "c", "d");
    expect(state.selected).toEqual(["b", "c", "d"]);
    state = extendSelection(order, state, "d", "c");
    expect(state.selected).toEqual(["b", "c"]);
    state = extendSelection(order, state, "c", "b");
    state = extendSelection(order, state, "b", "a");
    expect(state.selected).toEqual(["a", "b"]);
    state = toggleSelection(state, "a");
    expect(state.selected).toEqual(["b"]);
  });
  test("extending from an unselected row keeps earlier picks", () => {
    let state = toggleSelection(emptySelection, "a");
    state = extendSelection(order, state, "d", "e");
    expect(state.selected).toEqual(["a", "d", "e"]);
  });
});
