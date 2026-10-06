import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
function body(source: string, start: number) {
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;
    if (depth === 0) return source.slice(source.indexOf("{", start) + 1, index);
  }
  throw new Error("UNCLOSED_BLOCK");
}
function declarations(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found: Record<string, string> = {};
  for (const match of source.matchAll(
    new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, "g"),
  ))
    for (const line of (match[2] ?? "").split(";")) {
      const [name, ...value] = line.split(":");
      if (name?.trim()) found[name.trim()] = value.join(":").trim();
    }
  return found;
}

test("at phone width the enrollment actions column fits Resume and Stop and may wrap rather than clip", () => {
  const narrow = [...css.matchAll(/@media \(max-width: 760px\)\s*\{/g)]
    .map((match) => body(css, match.index ?? 0))
    .filter((block) => block.includes(".sequence-enrollments"))
    .join("\n");
  expect(declarations(narrow, ".sequence-enrollments th:last-child")).toEqual({
    width: "136px",
  });
  expect(
    declarations(narrow, ".sequence-enrollments td:last-child"),
  ).toMatchObject({ overflow: "visible", "white-space": "normal" });
  expect(declarations(narrow, ".sequence-enrollment-actions")).toMatchObject({
    "flex-wrap": "wrap",
  });
});
