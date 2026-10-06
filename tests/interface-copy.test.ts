import { expect, test } from "vitest";
import t from "../packages/i18n/translations/en.json";

function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value))
    return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      strings(item, path ? `${path}.${key}` : key),
    );
  return [];
}

test("interface copy makes no promise of features that come later", () => {
  const promises = strings(t).filter(([, text]) =>
    /\b(come|comes|coming) (later|soon)\b/i.test(text),
  );
  expect(promises).toEqual([]);
});
