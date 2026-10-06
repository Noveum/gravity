// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

const source = readFileSync("src/app/globals.css", "utf8");
const stylesheet = source.replaceAll("@media (hover: hover)", "@media all");

function resolve(value: string, element: Element, depth = 0): string {
  const match = value.trim().match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (!match || depth > 10) return value.trim();
  const [, name, fallback] = match;
  const own = getComputedStyle(element).getPropertyValue(name).trim();
  const inherited = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const next = own || inherited || fallback || "";
  return resolve(next, element, depth + 1);
}

function fill(button: HTMLElement) {
  const style = getComputedStyle(button);
  const current = style.getPropertyValue("--button-current").trim();
  return resolve(
    current || style.getPropertyValue("--button-fill").trim(),
    button,
  );
}

function painted(element: HTMLElement) {
  const style = getComputedStyle(element);
  const background = style.backgroundColor.trim();
  const current = style.getPropertyValue("--button-current").trim();
  const value = background.replace(
    /^var\(--button-current, (var\(--button-fill\))\)$/,
    current ? "var(--button-current)" : "$1",
  );
  return {
    background: resolve(value, element),
    color: resolve(style.color, element),
    display: style.display,
  };
}

function token(name: string) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function hovered<T>(button: HTMLElement, read: () => T): T {
  let value: T | undefined;
  button.addEventListener(
    "mouseover",
    () => {
      button.toggleAttribute("data-hover-probe");
      value = read();
    },
    { once: true },
  );
  button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  if (value === undefined) throw new Error("hover was not observed");
  return value;
}

function luminance(hex: string) {
  const value = hex.replace("#", "");
  expect(value).toMatch(/^[0-9a-f]{6}$/i);
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = stylesheet;
  document.head.append(style);
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("button hover in light mode", () => {
  test("the stylesheet paints buttons from the variant fill and leaves base element rules at zero specificity", () => {
    expect(stylesheet).toMatch(
      /:where\(\s*button[^)]*\) \{[^}]*background-color: var\(--button-current, var\(--button-fill\)\)/,
    );
    expect(stylesheet).toMatch(/--button-current: var\(--button-hover\);/);
    expect(stylesheet).not.toMatch(/(^|\n)button(:[\w-]+)*\s*[,{]/);
  });

  test.each([
    ["primary", "--gravity-accent", "--gravity-accent-hover"],
    ["secondary", "--gravity-surface", "--gravity-surface-2"],
    ["accent-soft", "--gravity-accent-soft", "--gravity-accent-soft-hover"],
  ])(
    "a hovered %s button keeps its own fill and never turns lighter or white",
    (variant, restToken, hoverToken) => {
      document.documentElement.classList.remove("dark");
      document.body.innerHTML = `<div class="toolbar"><button type="button" class="${variant}">Action</button></div>`;
      const button = document.querySelector("button") as HTMLButtonElement;
      const resting = fill(button);
      const hover = hovered(button, () => fill(button));
      expect(resting).toBe(token(restToken));
      expect(hover).toBe(token(hoverToken));
      expect(hover.toLowerCase()).not.toBe("#ffffff");
      expect(hover).not.toBe(token("--gravity-hover"));
      expect(luminance(hover)).toBeLessThanOrEqual(luminance(resting));
    },
  );
});

const variants: [string, string, string, string][] = [
  [
    "primary",
    "--gravity-accent",
    "--gravity-accent-hover",
    "--gravity-accent-contrast",
  ],
  ["secondary", "--gravity-surface", "--gravity-surface-2", "--gravity-text"],
  [
    "accent-soft",
    "--gravity-accent-soft",
    "--gravity-accent-soft-hover",
    "--gravity-accent",
  ],
  ["ghost", "transparent", "--gravity-surface-2", "--gravity-muted"],
  [
    "danger",
    "--gravity-danger",
    "--gravity-danger-hover",
    "--gravity-danger-contrast",
  ],
  [
    "chip",
    "--gravity-accent-soft",
    "--gravity-accent-soft-hover",
    "--gravity-accent",
  ],
  ["nav-item", "transparent", "--gravity-surface-2", "--gravity-muted"],
  ["menu-item", "transparent", "--gravity-menu-row", "--gravity-text"],
  ["icon-button", "transparent", "--gravity-surface-2", "--gravity-muted"],
];
const cases = ["light", "dark"].flatMap((theme) =>
  ["button", "a"].flatMap((tag) =>
    variants.map(([variant, rest, hover, ink]) => ({
      theme,
      tag,
      variant,
      rest,
      hover,
      ink,
    })),
  ),
);

describe("every button variant paints the same on buttons and links", () => {
  test.each(cases)(
    "$theme $tag $variant paints its own fill, ink and hover",
    ({ theme, tag, variant, rest, hover, ink }) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.body.innerHTML =
        tag === "a"
          ? `<a class="${variant}" href="/somewhere">Go</a>`
          : `<button type="button" class="${variant}">Go</button>`;
      const element = document.querySelector(tag) as HTMLElement;
      const expected = (name: string) =>
        name === "transparent" ? "transparent" : token(name);
      const resting = painted(element);
      const active = hovered(element, () => painted(element));
      expect(resting.background).toBe(expected(rest));
      expect(active.background).toBe(expected(hover));
      expect(resting.color).toBe(token(ink));
      expect(resting.color).not.toBe(
        tag === "a" && variant !== "accent-soft" && variant !== "chip"
          ? token("--gravity-accent")
          : "",
      );
      expect(resting.display).toMatch(/^(inline-)?flex$/);
      expect(active.background.toLowerCase()).not.toBe("#ffffff");
      if (theme === "light" && resting.background !== "transparent")
        expect(luminance(active.background)).toBeLessThanOrEqual(
          luminance(resting.background),
        );
      expect(active.background).not.toBe(resting.background);
    },
  );
});

describe("narrow screens", () => {
  function narrowRules() {
    const rules: string[] = [];
    for (const sheet of document.styleSheets)
      for (const rule of sheet.cssRules)
        if (
          rule instanceof CSSMediaRule &&
          rule.media.mediaText.replace(/\s/g, "") === "(max-width:760px)"
        )
          for (const inner of rule.cssRules) rules.push(inner.cssText);
    const narrow = document.createElement("style");
    narrow.dataset.narrow = "";
    narrow.textContent = rules.join("\n");
    document.head.append(narrow);
    return () => narrow.remove();
  }

  test("list rows and toolbar controls are at least 40px tall at 375px", () => {
    document.documentElement.classList.remove("dark");
    const restore = narrowRules();
    document.body.innerHTML = `<div class="toolbar"><select aria-label="Product"></select><label class="search"><input type="search" /></label><button type="button" class="chip">Chip</button><button type="button" class="primary toolbar-primary">New</button></div><button type="button" class="action-row">Row</button><table><tbody><tr><td>Cell</td></tr></tbody></table>`;
    const height = (selector: string, property: "minHeight" | "height") => {
      const element = document.querySelector(selector) as HTMLElement;
      return Number.parseFloat(
        resolve(getComputedStyle(element)[property], element),
      );
    };
    for (const selector of [
      ".toolbar select",
      ".toolbar .search",
      ".toolbar .chip",
      ".toolbar .primary",
    ])
      expect(height(selector, "minHeight")).toBeGreaterThanOrEqual(40);
    expect(height(".action-row", "height")).toBeGreaterThanOrEqual(40);
    expect(height("td", "height")).toBeGreaterThanOrEqual(40);
    restore();
  });
});
