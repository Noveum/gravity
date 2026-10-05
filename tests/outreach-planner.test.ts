import { describe, expect, test } from "vitest";
import {
  type PlannerInput,
  planEnrollment,
} from "../packages/core/outreach-planner";
import {
  type ContactRules,
  contactViolations,
  earliestContact,
  quietHoursEnd,
} from "../packages/core/outreach-rules";

const day = 86400000;
const at = (iso: string) => Date.parse(iso);
const rules: ContactRules = {
  cooldownDays: 3,
  dailyCapPerSender: 2,
  quietHoursStart: 20,
  quietHoursEnd: 8,
};
const steps = [0, 3, 5, 5].map((delayDays, index) => ({
  number: index + 1,
  delayDays,
  channel: "gmail" as const,
  template: `Template ${index + 1}`,
  followUp: index,
}));
const input = (overrides: Partial<PlannerInput> = {}): PlannerInput => ({
  now: at("2026-10-05T10:00:00Z"),
  enrollment: { status: "running", enrolledAt: at("2026-10-05T10:00:00Z") },
  steps,
  touches: [],
  doNotContact: false,
  timeZone: "UTC",
  lastContactAt: null,
  rules,
  ...overrides,
});

describe("quiet hours", () => {
  test("an instant inside quiet hours ends at the local end hour, outside returns nothing", () => {
    expect(quietHoursEnd(at("2026-10-05T21:30:00Z"), "UTC", rules)).toBe(
      at("2026-10-06T08:00:00Z"),
    );
    expect(quietHoursEnd(at("2026-10-05T03:00:00Z"), "UTC", rules)).toBe(
      at("2026-10-05T08:00:00Z"),
    );
    expect(quietHoursEnd(at("2026-10-05T08:00:00Z"), "UTC", rules)).toBeNull();
    expect(quietHoursEnd(at("2026-10-05T19:59:00Z"), "UTC", rules)).toBeNull();
  });

  test("quiet hours that do not wrap midnight, and equal hours meaning none", () => {
    const daytime = { ...rules, quietHoursStart: 12, quietHoursEnd: 14 };
    expect(quietHoursEnd(at("2026-10-05T13:00:00Z"), "UTC", daytime)).toBe(
      at("2026-10-05T14:00:00Z"),
    );
    expect(
      quietHoursEnd(at("2026-10-05T11:00:00Z"), "UTC", daytime),
    ).toBeNull();
    const none = { ...rules, quietHoursStart: 9, quietHoursEnd: 9 };
    expect(quietHoursEnd(at("2026-10-05T23:00:00Z"), "UTC", none)).toBeNull();
  });

  test("the end is found in the person's zone across a spring forward boundary", () => {
    const lateSaturday = at("2026-03-08T04:00:00Z");
    expect(quietHoursEnd(lateSaturday, "America/New_York", rules)).toBe(
      at("2026-03-08T12:00:00Z"),
    );
  });

  test("the end is found in the person's zone across a fall back boundary", () => {
    const lateSaturday = at("2026-11-01T03:00:00Z");
    expect(quietHoursEnd(lateSaturday, "America/New_York", rules)).toBe(
      at("2026-11-01T13:00:00Z"),
    );
  });

  test("the same instant is quiet in one zone and open in another", () => {
    const instant = at("2026-10-05T16:00:00Z");
    expect(quietHoursEnd(instant, "Europe/London", rules)).toBeNull();
    expect(quietHoursEnd(instant, "Asia/Kolkata", rules)).toBe(
      at("2026-10-06T02:30:00Z"),
    );
  });
});

describe("contact rules", () => {
  const base = {
    now: at("2026-10-05T10:00:00Z"),
    doNotContact: false,
    timeZone: "UTC",
    lastContactAt: null,
    sentTodayBySender: 0,
    rules,
  };

  test("a clear person has no violations", () => {
    expect(contactViolations(base)).toEqual([]);
  });

  test("do not contact is reported", () => {
    expect(contactViolations({ ...base, doNotContact: true })).toEqual([
      { code: "DO_NOT_CONTACT" },
    ]);
  });

  test("a cooldown reports the earliest allowed time", () => {
    const lastContactAt = at("2026-10-04T09:00:00Z");
    expect(contactViolations({ ...base, lastContactAt })).toEqual([
      { code: "CONTACT_COOLDOWN", until: lastContactAt + 3 * day },
    ]);
    expect(
      contactViolations({ ...base, lastContactAt: base.now - 3 * day }),
    ).toEqual([]);
  });

  test("the daily cap is reached when the sender has already sent the cap", () => {
    expect(contactViolations({ ...base, sentTodayBySender: 1 })).toEqual([]);
    expect(contactViolations({ ...base, sentTodayBySender: 2 })).toEqual([
      { code: "DAILY_CAP_REACHED", cap: 2 },
    ]);
  });

  test("quiet hours report when they end", () => {
    expect(
      contactViolations({ ...base, now: at("2026-10-05T22:00:00Z") }),
    ).toEqual([{ code: "QUIET_HOURS", until: at("2026-10-06T08:00:00Z") }]);
  });

  test("the earliest contact moves past the cooldown and then out of quiet hours", () => {
    expect(
      earliestContact(at("2026-10-05T10:00:00Z"), {
        timeZone: "UTC",
        lastContactAt: at("2026-10-03T21:00:00Z"),
        rules,
      }),
    ).toBe(at("2026-10-07T08:00:00Z"));
    expect(
      earliestContact(at("2026-10-05T10:00:00Z"), {
        timeZone: "UTC",
        lastContactAt: null,
        rules,
      }),
    ).toBe(at("2026-10-05T10:00:00Z"));
  });
});

describe("the planner", () => {
  test("the first touch is due at enrollment time", () => {
    expect(planEnrollment(input())).toEqual({
      kind: "create",
      step: steps[0],
      dueAt: at("2026-10-05T10:00:00Z"),
    });
  });

  test("a first touch enrolled during quiet hours is moved to when they end", () => {
    const enrolledAt = at("2026-10-05T23:00:00Z");
    expect(
      planEnrollment(
        input({
          now: enrolledAt,
          enrollment: { status: "running", enrolledAt },
        }),
      ),
    ).toMatchObject({ kind: "create", dueAt: at("2026-10-06T08:00:00Z") });
  });

  test("a first touch is moved past a cooldown from another brand", () => {
    expect(
      planEnrollment(input({ lastContactAt: at("2026-10-04T12:00:00Z") })),
    ).toMatchObject({ kind: "create", dueAt: at("2026-10-07T12:00:00Z") });
  });

  test("nothing is planned while the previous touch is open", () => {
    for (const status of ["planned", "drafted", "approved"] as const)
      expect(
        planEnrollment(
          input({
            now: at("2026-10-20T10:00:00Z"),
            touches: [{ stepNumber: 1, status, sentAt: null, closedAt: null }],
          }),
        ),
      ).toEqual({ kind: "wait" });
  });

  test("the next touch waits for the step delay measured from the send", () => {
    const sentAt = at("2026-10-06T15:00:00Z");
    const touches = [
      { stepNumber: 1, status: "sent" as const, sentAt, closedAt: null },
    ];
    expect(
      planEnrollment(
        input({ now: sentAt + 3 * day - 1, touches, lastContactAt: sentAt }),
      ),
    ).toEqual({ kind: "wait" });
    expect(
      planEnrollment(
        input({ now: sentAt + 3 * day, touches, lastContactAt: sentAt }),
      ),
    ).toEqual({ kind: "create", step: steps[1], dueAt: sentAt + 3 * day });
  });

  test("a skipped touch lets the next step follow from when it was skipped", () => {
    const closedAt = at("2026-10-06T09:00:00Z");
    expect(
      planEnrollment(
        input({
          now: closedAt + 3 * day,
          touches: [
            { stepNumber: 1, status: "skipped", sentAt: null, closedAt },
          ],
        }),
      ),
    ).toEqual({ kind: "create", step: steps[1], dueAt: closedAt + 3 * day });
  });

  test("a step whose delay ends in quiet hours is due when they end", () => {
    const sentAt = at("2026-10-06T21:00:00Z");
    expect(
      planEnrollment(
        input({
          now: sentAt + 4 * day,
          touches: [{ stepNumber: 1, status: "sent", sentAt, closedAt: null }],
          lastContactAt: sentAt,
        }),
      ),
    ).toMatchObject({ kind: "create", dueAt: at("2026-10-10T08:00:00Z") });
  });

  test("the enrollment completes once every step is sent or skipped", () => {
    const sentAt = at("2026-10-06T10:00:00Z");
    const touches = steps.map((step) => ({
      stepNumber: step.number,
      status: step.number === 2 ? ("skipped" as const) : ("sent" as const),
      sentAt: step.number === 2 ? null : sentAt,
      closedAt: step.number === 2 ? sentAt : null,
    }));
    expect(planEnrollment(input({ touches }))).toEqual({ kind: "complete" });
  });

  test("a do not contact person pauses the enrollment instead of planning", () => {
    expect(planEnrollment(input({ doNotContact: true }))).toEqual({
      kind: "pause",
      reason: "do_not_contact",
    });
  });

  test("paused, stopped and completed enrollments are left alone", () => {
    for (const status of ["paused", "stopped", "completed"] as const)
      expect(
        planEnrollment(
          input({
            enrollment: { status, enrolledAt: at("2026-10-05T10:00:00Z") },
          }),
        ),
      ).toEqual({ kind: "wait" });
  });

  test("planning is deterministic and steps are taken in number order", () => {
    const shuffled = [...steps].reverse();
    expect(planEnrollment(input({ steps: shuffled }))).toEqual(
      planEnrollment(input()),
    );
  });
});
