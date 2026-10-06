import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
function block(source: string, opener: string) {
  const start = source.indexOf(opener);
  if (start < 0) throw new Error(`MISSING_BLOCK:${opener}`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;
    if (depth === 0) return source.slice(source.indexOf("{", start) + 1, index);
  }
  throw new Error(`UNCLOSED_BLOCK:${opener}`);
}
function declarations(source: string, selector: string) {
  const pattern = new RegExp(
    `(^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  const found: Record<string, string> = {};
  for (const match of source.matchAll(pattern))
    for (const line of match[2].split(";")) {
      const [name, ...value] = line.split(":");
      if (name.trim()) found[name.trim()] = value.join(":").trim();
    }
  return found;
}

test("the product access popover stays inside a narrow settings column", () => {
  const narrow = block(css, "@container (max-width: 720px)");
  expect(declarations(narrow, ".settings-popover")).toMatchObject({
    left: "0",
    right: "auto",
    "max-width": "calc(100cqi - 32px)",
  });
});
