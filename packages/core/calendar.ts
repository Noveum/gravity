import t from "../i18n/translations/en.json";

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const day = 86400000;

function formatter(timeZone: string) {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  formatters.set(timeZone, created);
  return created;
}

function wallClock(instant: number, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdays.indexOf(parts.weekday ?? ""),
  };
}

function offset(instant: number, timeZone: string) {
  const clock = wallClock(instant, timeZone);
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
  );
  return asUtc - Math.floor(instant / 60000) * 60000;
}

function zonedInstant(
  year: number,
  month: number,
  date: number,
  hour: number,
  timeZone: string,
) {
  const guess = Date.UTC(year, month - 1, date, hour);
  const first = guess - offset(guess, timeZone);
  return guess - offset(first, timeZone);
}

function dayNumber(instant: number, timeZone: string) {
  const clock = wallClock(instant, timeZone);
  return Date.UTC(clock.year, clock.month - 1, clock.day) / day;
}

export function nextWorkingMorning(now: number, timeZone: string) {
  const today = wallClock(now, timeZone);
  const ahead = today.weekday === 5 ? 3 : today.weekday === 6 ? 2 : 1;
  const target = new Date(
    Date.UTC(today.year, today.month - 1, today.day + ahead),
  );
  return zonedInstant(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    9,
    timeZone,
  );
}

export function dueToday(dueAt: string, now: number, timeZone: string) {
  return dayNumber(Date.parse(dueAt), timeZone) <= dayNumber(now, timeZone);
}

export function snoozeLabel(target: number, now: number, timeZone: string) {
  if (dayNumber(target, timeZone) - dayNumber(now, timeZone) === 1)
    return t.snoozeTomorrow;
  return t.weekdays[wallClock(target, timeZone).weekday] ?? t.snoozeTomorrow;
}
