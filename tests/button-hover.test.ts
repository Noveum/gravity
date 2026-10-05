// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

const stylesheet = readFileSync("src/app/globals.css", "utf8");

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
      /:where\(button(, a\.[\w-]+)*\) \{[^}]*background-color: var\(--button-current, var\(--button-fill\)\)/,
    );
    expect(stylesheet).toMatch(
      /:where\(button:not\(:disabled\):hover(, a\.[\w-]+:hover)*\) \{\s*--button-current: var\(--button-hover\);\s*\}/,
    );
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
      const token = (name: string) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue(name)
          .trim();
      const resting = fill(button);
      const hover = hovered(button, () => fill(button));
      expect(resting).toBe(token(restToken));
      expect(hover).toBe(token(hoverToken));
      expect(hover.toLowerCase()).not.toBe("#ffffff");
      expect(hover).not.toBe(token("--gravity-hover"));
      expect(luminance(hover)).toBeLessThanOrEqual(luminance(resting));
    },
  );

  test("links styled as buttons take their ink after the base link colour", () => {
    const base = stylesheet.search(
      /:where\(a\) \{\s*color: var\(--gravity-accent\);/,
    );
    const ink = stylesheet.search(
      /:where\(a\.button, a\.nav-item, a\.text-button\) \{\s*color: var\(--button-ink\);\s*text-decoration: none;/,
    );
    expect(base).toBeGreaterThan(-1);
    expect(ink).toBeGreaterThan(base);
  });
});
