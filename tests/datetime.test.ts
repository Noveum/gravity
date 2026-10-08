import { expect, test } from "vitest";
import {
  preciseInstantSchema,
  preciseOffsetInstantSchema,
} from "../packages/core/datetime";

test("precise instants reject ISO year zero before binding a PostgreSQL timestamp", () => {
  for (const schema of [preciseInstantSchema, preciseOffsetInstantSchema]) {
    expect(schema.safeParse("0000-01-01T00:00:00.000Z").success).toBe(false);
    expect(schema.safeParse("0001-01-01T00:00:00.123Z").success).toBe(true);
    expect(schema.safeParse("2026-10-08T00:00:00.1234Z").success).toBe(false);
  }
  expect(
    preciseOffsetInstantSchema.safeParse("0000-12-31T23:00:00+01:00").success,
  ).toBe(false);
});
