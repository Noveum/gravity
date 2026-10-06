// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/app/globals.css", "utf8");
  document.head.append(style);
});
afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.body.innerHTML = "";
});

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
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

test.each([
  ["light", false],
  ["dark", true],
])(
  "%s field borders reach 3:1 against the surfaces fields sit on",
  (_, dark) => {
    document.documentElement.classList.toggle("dark", dark);
    const border = token("--gravity-field-border");
    for (const surface of ["--gravity-surface", "--gravity-popover"])
      expect(contrast(border, token(surface)), surface).toBeGreaterThanOrEqual(
        3,
      );
  },
);

test("every field boundary draws its border from the field token", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const fieldRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, selector, body]) =>
      /(?<![.\w-])(input|select|textarea)\b(?!-)|^\s*\.search\s*$/.test(selector) &&
      /border(-color)?\s*:/.test(body),
  );
  expect(fieldRules.length).toBeGreaterThan(1);
  for (const [, selector, body] of fieldRules)
    for (const border of body.match(/border(-color)?\s*:[^;]*;/g) ?? [])
      expect(border, selector.trim()).toMatch(
        /var\(--gravity-field-border\)|border:\s*0;/,
      );
});
