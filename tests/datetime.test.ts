import { expect, test } from "vitest";
import {
  cursorInstantSchema,
  preciseInstantSchema,
  preciseOffsetInstantSchema,
} from "../packages/core/datetime";

test("cursor instants preserve database microseconds without year or precision overflow", () => {
  for (const value of [
    "0001-01-01T00:00:00Z",
    "2026-10-08T00:00:00.123456Z",
    "9999-12-31T23:59:59.999999Z",
  ])
    expect(cursorInstantSchema.parse(value)).toBe(value);
  for (const value of [
    "0000-01-01T00:00:00Z",
    "2026-10-08T00:00:00.1234567Z",
    "9999-12-31T23:59:59.9999999Z",
  ])
    expect(cursorInstantSchema.safeParse(value).success).toBe(false);
});

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

test.each(["0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00"])(
  "offset instants reject normalized UTC range overflow: %s",
  (value) => {
    expect(preciseOffsetInstantSchema.safeParse(value).success).toBe(false);
  },
);

test("precise instants retain valid normalized UTC range boundaries and millisecond precision", () => {
  for (const value of [
    "0001-01-01T00:00:00.123Z",
    "9999-12-31T23:59:59.999Z",
  ]) {
    expect(preciseInstantSchema.parse(value)).toBe(value);
    expect(preciseOffsetInstantSchema.parse(value)).toBe(value);
  }
  for (const [value, canonical] of [
    ["0001-01-01T01:00:00.123+01:00", "0001-01-01T00:00:00.123Z"],
    ["9999-12-31T22:59:59.999-01:00", "9999-12-31T23:59:59.999Z"],
  ]) {
    expect(preciseOffsetInstantSchema.parse(value)).toBe(value);
    expect(new Date(value).toISOString()).toBe(canonical);
    expect(
      preciseOffsetInstantSchema.safeParse(
        value.replace(".123", ".1234").replace(".999", ".9999"),
      ).success,
    ).toBe(false);
  }
  expect(
    preciseOffsetInstantSchema.safeParse("0000-12-31T23:00:00-01:00").success,
  ).toBe(false);
});
