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

test("settings rows hold 28px on fine pointers and grow controls to 36px on touch", () => {
  const top = css.replace(
    /@(media|container)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
    "",
  );
  expect(declarations(top, ".settings-row")).toMatchObject({
    padding: "0",
    "box-sizing": "border-box",
    "min-height": "var(--gravity-list-row)",
  });
  const controls = declarations(
    top,
    `.settings-row :is(button, select, summary, input:not([type="checkbox"]))`,
  );
  expect(controls["min-height"]).toBe("26px");
  const coarse = [...css.matchAll(/@media \(pointer: coarse\)\s*\{/g)]
    .map((match) => block(css.slice(match.index), "@media (pointer: coarse)"))
    .join("\n");
  expect(
    declarations(
      coarse,
      `.settings-row :is(button, select, summary, input:not([type="checkbox"]))`,
    )["min-height"],
  ).toBe("36px");
});

test("settings row actions wrap inside a narrow settings container", () => {
  const narrow = block(css, "@container (max-width: 720px)");
  expect(declarations(narrow, ".settings-row-actions")).toMatchObject({
    "justify-content": "flex-start",
    "flex-wrap": "wrap",
    "flex-shrink": "1",
    "min-width": "0",
    "max-width": "100%",
  });
});
