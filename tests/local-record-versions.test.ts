import { expect, test } from "vitest";
import { LocalRecordVersions } from "../src/components/crm/local-record-versions";

test("consecutive local field saves preserve each other's values and versions", () => {
  const versions = new LocalRecordVersions();
  const original = {
    id: "contact",
    version: 1,
    notes: "Old notes",
    phone: "Old phone",
  };
  versions.remember("workspace", 1, {
    ...original,
    notes: "New notes",
    version: 2,
  });
  expect(versions.current("workspace", original)).toEqual({
    ...original,
    notes: "New notes",
    version: 2,
  });
  const second = {
    ...versions.current("workspace", original),
    phone: "New phone",
    version: 3,
  };
  versions.remember("workspace", 2, second);
  expect(versions.current("workspace", original)).toEqual(second);
  expect(versions.current("other-workspace", original)).toBe(original);
});

test("a gap caused by an external update never rebases an old draft", () => {
  const versions = new LocalRecordVersions();
  const original = { id: "contact", version: 1 };
  versions.remember("workspace", 1, { ...original, version: 2 });
  versions.remember("workspace", 3, { ...original, version: 4 });
  expect(versions.current("workspace", original)).toBe(original);
  expect(
    versions.current("workspace", { ...original, version: 3 }),
  ).toHaveProperty("version", 4);
  versions.clear();
  expect(versions.current("workspace", original)).toBe(original);
});
