// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

function rules(source: string) {
  const found: { selector: string; body: string; context: string[] }[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "{") {
      const head = source.slice(start, index).trim();
      const close = source.indexOf("}", index);
      const nextOpen = source.indexOf("{", index + 1);
      if (head.startsWith("@") || (nextOpen !== -1 && nextOpen < close)) {
        stack.push(head);
        start = index + 1;
        continue;
      }
      found.push({
        selector: head.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
        body: source.slice(index + 1, close),
        context: [...stack],
      });
      index = close;
      start = close + 1;
    } else if (character === "}") {
      stack.pop();
      start = index + 1;
    }
  }
  return found;
}
function mount(source: string, html: string) {
  const style = document.createElement("style");
  style.textContent = source;
  document.head.append(style);
  document.body.innerHTML = html;
}
afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

test("every hover style applies only on devices that can hover", () => {
  const unguarded = rules(css)
    .filter((rule) => rule.selector.includes(":hover"))
    .filter(
      (rule) =>
        !rule.context.some((at) => at.startsWith("@media (hover: hover)")),
    )
    .map((rule) => rule.selector);
  expect(unguarded).toEqual([]);
});

test("keyboard hints disappear on coarse pointers", () => {
  const html = `<button class="primary"><span class="shortcut-hint"><kbd>N</kbd></span></button>`;
  mount(css, html);
  const hint = () => document.querySelector(".shortcut-hint") as HTMLElement;
  expect(getComputedStyle(hint()).display).not.toBe("none");
  document.head.innerHTML = "";
  mount(css.replaceAll("@media (pointer: coarse)", "@media all"), html);
  expect(getComputedStyle(hint()).display).toBe("none");
});

test("at phone width the toolbar wraps so its primary action stays on screen", () => {
  const narrow = rules(css).filter((rule) =>
    rule.context.includes("@media (max-width: 760px)"),
  );
  const toolbar = narrow.find((rule) => rule.selector === ".toolbar");
  expect(toolbar?.body).toMatch(/flex-wrap:\s*wrap/);
  expect(toolbar?.body).not.toMatch(/overflow-x:\s*auto/);
  const search = narrow.find((rule) => rule.selector === ".toolbar .search");
  expect(search?.body).toMatch(/flex:\s*1 1 100%/);
  const primary = narrow.find(
    (rule) => rule.selector === ".toolbar .toolbar-primary",
  );
  expect(primary?.body).toMatch(/margin-left:\s*auto/);
  const status = narrow.find(
    (rule) => rule.selector === ".toolbar .selection-status",
  );
  expect(status?.body ?? "").not.toMatch(/position:\s*sticky/);
});
