import { expect, test } from "vitest";
import { weightedAmount } from "../packages/core/analytics";
import { formatMoney } from "../src/components/money";

test("displayed amounts retain ISO currency precision", () => {
  expect(formatMoney(123456, "USD")).toBe("$1,234.56");
  expect(formatMoney(12, "JPY")).toContain("12");
  expect(formatMoney(12345, "KWD")).toContain("12.345");
});
test("weighted revenue distinguishes unknown fields from zero and rounds in minor units", () => {
  expect(weightedAmount(123456, 50)).toBe(61728);
  expect(weightedAmount(1, 50)).toBe(1);
  expect(weightedAmount(10000, 0)).toBe(0);
  expect(weightedAmount(0, 40)).toBe(0);
  expect(weightedAmount(null, 40)).toBeNull();
  expect(weightedAmount(10000, null)).toBeNull();
});
