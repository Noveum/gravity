import { describe, expect, test } from "vitest";
import { type ShortcutInput, shortcutFor } from "../packages/core/shortcuts";

const input = (extra: Partial<ShortcutInput> = {}): ShortcutInput => ({
  key: "n",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  isEditing: false,
  isModal: false,
  prefix: false,
  ...extra,
});
describe("keyboard safety", () => {
  test("typing, IME and modal forms never create tasks or navigate", () => {
    for (const key of ["n", "j", "k", "g", "/", "ArrowDown", "?"]) {
      expect(shortcutFor(input({ key, isEditing: true }))).toBeNull();
      expect(shortcutFor(input({ key, isComposing: true }))).toBeNull();
      expect(shortcutFor(input({ key, isModal: true }))).toBeNull();
    }
  });
  test("command menu uses platform modifier without taking browser shortcuts", () => {
    expect(
      shortcutFor(input({ key: "k", metaKey: true, isEditing: true })),
    ).toBe("commands");
    expect(shortcutFor(input({ key: "k", ctrlKey: true }))).toBe("commands");
    expect(shortcutFor(input({ key: "l", metaKey: true }))).toBeNull();
    expect(shortcutFor(input({ key: "n", ctrlKey: true }))).toBeNull();
    expect(shortcutFor(input({ key: "a", prefix: true }))).toBe("actions");
    expect(shortcutFor(input({ key: "a" }))).toBeNull();
  });
});

describe("complete keyboard map", () => {
  test("all views have unambiguous go-to chords", () => {
    const views = {
      a: "actions",
      p: "people",
      c: "companies",
      s: "sequences",
      m: "meetings",
      o: "opportunities",
      f: "materials",
      i: "integrations",
      t: "settings",
    };
    for (const [key, view] of Object.entries(views))
      expect(shortcutFor(input({ key, prefix: true }))).toBe(view);
    expect(shortcutFor(input({ key: "c" }))).toBe("create");
    expect(shortcutFor(input({ key: "?", shiftKey: true }))).toBe("help");
    expect(shortcutFor(input({ key: "l" }))).toBe("detailFocus");
    expect(shortcutFor(input({ key: "3" }))).toBe("draft");
    expect(shortcutFor(input({ key: "[" }))).toBe("sidebar");
    expect(shortcutFor(input({ key: "[", isEditing: true }))).toBeNull();
    expect(shortcutFor(input({ key: "[", isModal: true }))).toBeNull();
  });
  test("consumed events, held create keys and modified shortcuts do not trigger actions", () => {
    expect(shortcutFor(input({ defaultPrevented: true }))).toBeNull();
    for (const key of ["g", "c", "n"])
      expect(shortcutFor(input({ key, repeat: true }))).toBeNull();
    expect(
      shortcutFor(input({ key: "k", metaKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      shortcutFor(input({ key: "k", ctrlKey: true, isModal: true })),
    ).toBeNull();
    expect(shortcutFor(input({ key: "Enter", metaKey: true }))).toBeNull();
  });
});
