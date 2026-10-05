import { describe, expect, test } from "vitest";
import {
  dueToday,
  nextWorkingMorning,
  snoozeLabel,
} from "../packages/core/calendar";

describe("workspace calendar", () => {
  test("the next working morning is 9:00 tomorrow in the workspace zone, or Monday after Friday and the weekend", () => {
    const thursdayNight = Date.parse("2026-10-08T20:00:00.000Z");
    expect(
      new Date(nextWorkingMorning(thursdayNight, "UTC")).toISOString(),
    ).toBe("2026-10-09T09:00:00.000Z");
    expect(
      new Date(nextWorkingMorning(thursdayNight, "Asia/Kolkata")).toISOString(),
    ).toBe("2026-10-12T03:30:00.000Z");
    const friday = Date.parse("2026-10-09T10:00:00.000Z");
    expect(new Date(nextWorkingMorning(friday, "UTC")).toISOString()).toBe(
      "2026-10-12T09:00:00.000Z",
    );
    const sunday = Date.parse("2026-10-11T23:00:00.000Z");
    expect(
      new Date(nextWorkingMorning(sunday, "America/New_York")).toISOString(),
    ).toBe("2026-10-12T13:00:00.000Z");
    const beforeDst = Date.parse("2026-03-06T15:00:00.000Z");
    expect(
      new Date(nextWorkingMorning(beforeDst, "America/New_York")).toISOString(),
    ).toBe("2026-03-09T13:00:00.000Z");
  });
  test("due today means overdue or due on the current calendar day in the workspace zone", () => {
    const now = Date.parse("2026-10-05T11:00:00.000Z");
    expect(dueToday("2026-10-04T23:14:00.000Z", now, "UTC")).toBe(true);
    expect(dueToday("2026-10-05T23:59:00.000Z", now, "UTC")).toBe(true);
    expect(dueToday("2026-10-06T00:01:00.000Z", now, "UTC")).toBe(false);
    expect(dueToday("2026-10-05T19:00:00.000Z", now, "Asia/Kolkata")).toBe(
      false,
    );
    expect(dueToday("2026-10-05T18:00:00.000Z", now, "Asia/Kolkata")).toBe(
      true,
    );
  });
  test("the label names tomorrow or the weekday of the morning", () => {
    const thursday = Date.parse("2026-10-08T12:00:00.000Z");
    expect(
      snoozeLabel(nextWorkingMorning(thursday, "UTC"), thursday, "UTC"),
    ).toBe("tomorrow morning");
    const friday = Date.parse("2026-10-09T12:00:00.000Z");
    expect(snoozeLabel(nextWorkingMorning(friday, "UTC"), friday, "UTC")).toBe(
      "Monday",
    );
  });
});
