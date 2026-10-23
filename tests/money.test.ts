import { describe, expect, test } from "vitest";
import t from "../packages/i18n/translations/en.json";
import {
  formatMoney,
  fromMinor,
  minorDigits,
  minorStep,
  toMinor,
} from "../src/components/money";

describe("money helpers", () => {
  test.each([
    { currency: "USD", digits: 2, step: "0.01", major: "12.34", minor: 1234 },
    { currency: "JPY", digits: 0, step: "1", major: "1234", minor: 1234 },
    { currency: "KWD", digits: 3, step: "0.001", major: "12.345", minor: 12345 },
    { currency: "BHD", digits: 3, step: "0.001", major: "12.345", minor: 12345 },
  ])(
    "uses $currency precision for conversions and input steps",
    ({ currency, digits, step, major, minor }) => {
      expect(minorDigits(currency)).toBe(digits);
      expect(minorStep(currency)).toBe(step);
      expect(toMinor(major, currency)).toBe(minor);
      expect(fromMinor(minor, currency)).toBe(major);
      expect(toMinor("0", currency)).toBe(0);
      expect(fromMinor(0, currency)).toBe("0");
      expect(toMinor(`-${major}`, currency)).toBe(-minor);
      expect(fromMinor(-minor, currency)).toBe(`-${major}`);
    },
  );

  test.each([
    ["USD", "12.344", 1234],
    ["USD", "12.346", 1235],
    ["JPY", "12.4", 12],
    ["JPY", "12.6", 13],
    ["KWD", "12.3454", 12345],
    ["KWD", "12.3456", 12346],
    ["BHD", "12.3454", 12345],
    ["BHD", "12.3456", 12346],
  ])("rounds excess decimals for %s input %s", (currency, input, minor) => {
    expect(toMinor(input, currency)).toBe(minor);
  });

  // Display labels currently round to whole major units, unlike conversions.
  test.each([
    ["USD", 12345, "$123"],
    ["JPY", 12345, "¥12,345"],
    ["KWD", 12345, "KWD\u00a012"],
    ["BHD", 12345, "BHD\u00a012"],
    ["USD", 1250, "$13"],
  ])("formats %s minor amount %i", (currency, minor, formatted) => {
    expect(formatMoney(minor, currency)).toBe(formatted);
  });

  test.each(["USD", "JPY", "KWD", "BHD"])(
    "keeps empty and unknown %s amounts distinct from zero",
    (currency) => {
      expect(toMinor("", currency)).toBeNull();
      expect(toMinor("   ", currency)).toBeNull();
      expect(fromMinor(null, currency)).toBe("");
      expect(formatMoney(null, currency)).toBe(t.amountUnknown);
      expect(toMinor(" 12 ", currency)).toBe(toMinor("12", currency));
    },
  );

  test.each(["not a number", "NaN", "Infinity", "-Infinity"])(
    "rejects non-finite input %s",
    (input) => {
      expect(toMinor(input, "USD")).toBeNaN();
    },
  );

  test("falls back for a malformed currency", () => {
    expect(minorDigits("invalid")).toBe(2);
    expect(minorStep("invalid")).toBe("0.01");
    expect(toMinor("12.34", "invalid")).toBe(1234);
    expect(fromMinor(1234, "invalid")).toBe("12.34");
    expect(formatMoney(1234, "invalid")).toBe("invalid 12");
  });
});
