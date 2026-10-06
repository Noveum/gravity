import { wallClock, zonedDayBounds, zonedInstant } from "./calendar";

const day = 86400000;

export interface ContactRules {
  cooldownDays: number;
  dailyCapPerSender: number;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export const defaultContactRules: ContactRules = {
  cooldownDays: 3,
  dailyCapPerSender: 40,
  quietHoursStart: 20,
  quietHoursEnd: 8,
};

export type ContactViolation =
  | { code: "DO_NOT_CONTACT" }
  | { code: "CONTACT_COOLDOWN"; until: number }
  | { code: "DAILY_CAP_REACHED"; cap: number }
  | { code: "QUIET_HOURS"; until: number };

export function quietHoursEnd(
  instant: number,
  timeZone: string,
  rules: ContactRules,
) {
  const start = rules.quietHoursStart;
  const end = rules.quietHoursEnd;
  if (start === end) return null;
  const clock = wallClock(instant, timeZone);
  const quiet =
    start < end
      ? clock.hour >= start && clock.hour < end
      : clock.hour >= start || clock.hour < end;
  if (!quiet) return null;
  const nextDay = start > end && clock.hour >= start ? 1 : 0;
  return zonedInstant(
    clock.year,
    clock.month,
    clock.day + nextDay,
    end,
    timeZone,
  );
}

function quietHourSet(rules: ContactRules) {
  const hours = new Set<number>();
  for (
    let hour = rules.quietHoursStart;
    hour !== rules.quietHoursEnd;
    hour = (hour + 1) % 24
  )
    hours.add(hour);
  return hours;
}

export function loosensContactRules(current: ContactRules, next: ContactRules) {
  const nextQuiet = quietHourSet(next);
  return (
    next.dailyCapPerSender > current.dailyCapPerSender ||
    next.cooldownDays < current.cooldownDays ||
    [...quietHourSet(current)].some((hour) => !nextQuiet.has(hour))
  );
}

export function cooldownEnd(lastContactAt: number | null, rules: ContactRules) {
  return lastContactAt === null
    ? null
    : lastContactAt + rules.cooldownDays * day;
}

export function earliestContact(
  instant: number,
  context: {
    timeZone: string;
    lastContactAt: number | null;
    rules: ContactRules;
  },
) {
  const afterCooldown = Math.max(
    instant,
    cooldownEnd(context.lastContactAt, context.rules) ?? instant,
  );
  return (
    quietHoursEnd(afterCooldown, context.timeZone, context.rules) ??
    afterCooldown
  );
}

export function contactViolations(input: {
  now: number;
  doNotContact: boolean;
  timeZone: string;
  lastContactAt: number | null;
  sentTodayBySender: number;
  rules: ContactRules;
}): ContactViolation[] {
  if (input.doNotContact) return [{ code: "DO_NOT_CONTACT" }];
  const violations: ContactViolation[] = [];
  const cooldown = cooldownEnd(input.lastContactAt, input.rules);
  if (cooldown !== null && input.now < cooldown)
    violations.push({ code: "CONTACT_COOLDOWN", until: cooldown });
  if (input.sentTodayBySender >= input.rules.dailyCapPerSender)
    violations.push({
      code: "DAILY_CAP_REACHED",
      cap: input.rules.dailyCapPerSender,
    });
  const quiet = quietHoursEnd(input.now, input.timeZone, input.rules);
  if (quiet !== null) violations.push({ code: "QUIET_HOURS", until: quiet });
  return violations;
}

export function sendWindow(input: {
  now: number;
  doNotContact: boolean;
  timeZone: string;
  workspaceTimeZone: string;
  lastContactAt: number | null;
  sentTodayBySender: number;
  rules: ContactRules;
}) {
  const reasons = contactViolations(input);
  if (input.doNotContact)
    return { allowed: false, sendAfter: null, reasons } as const;
  const capped = reasons.some((reason) => reason.code === "DAILY_CAP_REACHED");
  const notBefore = capped
    ? zonedDayBounds(input.now, input.workspaceTimeZone)[1]
    : input.now;
  const sendAfter = earliestContact(notBefore, {
    timeZone: input.timeZone,
    lastContactAt: input.lastContactAt,
    rules: input.rules,
  });
  return { allowed: reasons.length === 0, sendAfter, reasons } as const;
}
