import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
// Radix sets these on its popper elements at runtime.
const runtime = /^--radix-/;

test("every custom property the stylesheet reads without a fallback is defined", () => {
  const defined = new Set(
    [...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name),
  );
  const undefinedReads = [...css.matchAll(/var\((--[\w-]+)\s*\)/g)]
    .map(([, name]) => name)
    .filter((name) => !defined.has(name) && !runtime.test(name));
  expect([...new Set(undefinedReads)]).toEqual([]);
});
