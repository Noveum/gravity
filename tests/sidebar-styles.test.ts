// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/app/globals.css", "utf8");
  document.head.append(style);
});

test("a sidebar label takes the free width and its shortcut hint only what it needs", () => {
  document.body.innerHTML = `<nav class="sidebar"><a class="nav-item" href="/actions"><span class="nav-label-text">Next actions</span><span class="shortcut-hint nav-shortcut nav-label-text"><kbd>G A</kbd></span><span class="nav-count nav-label-text">7</span></a></nav>`;
  const [label, hint] = document.querySelectorAll<HTMLElement>(
    ".nav-item > .nav-label-text",
  );
  expect(getComputedStyle(label).flexGrow).toBe("1");
  expect(getComputedStyle(label).textOverflow).toBe("ellipsis");
  expect(getComputedStyle(hint).flexGrow).toBe("0");
  expect(getComputedStyle(hint).flexShrink).toBe("0");
});
