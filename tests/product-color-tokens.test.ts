import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { productColorKeys } from "../packages/core/product-colors";

function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  return css.slice(start, css.indexOf("\n}", start));
}
async function sources(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return sources(path);
      return Promise.resolve(/\.tsx?$/.test(entry.name) ? [path] : []);
    }),
  );
  return nested.flat();
}

test("every product colour key has a light and a dark theme token", async () => {
  const css = await readFile(
    join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );
  for (const selector of [":root", ":root.dark"]) {
    const theme = block(css, selector);
    for (const key of productColorKeys)
      expect(theme).toMatch(
        new RegExp(`--gravity-product-${key}:\\s*#[0-9a-f]{6};`),
      );
  }
});

test("components never paint a product with a stored colour value", async () => {
  const offenders: string[] = [];
  for (const path of await sources(join(process.cwd(), "src")))
    if (/\.color\b(?!Key)/.test(await readFile(path, "utf8")))
      offenders.push(path);
  expect(offenders).toEqual([]);
});
