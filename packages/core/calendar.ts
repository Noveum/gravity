import t from "../i18n/translations/en.json";

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
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
    second: "2-digit",
    weekday: "short",
  });
  formatters.set(timeZone, created);
  return created;
}

export function wallClock(instant: number, timeZone: string): WallClock {
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
    second: Number(parts.second),
    weekday: weekdays.indexOf(parts.weekday ?? ""),
  };
}

// Date.UTC interprets years 0–99 as 1900–1999. Calendar inputs and recurrence
// must use the literal year while still allowing day/month normalization.
export function utcCalendarInstant(
  year: number,
  month: number,
  date: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, date);
  value.setUTCHours(hour, minute, second, 0);
  return value.getTime();
}

function offset(instant: number, timeZone: string) {
  const clock = wallClock(instant, timeZone);
  const asUtc = utcCalendarInstant(
    clock.year,
    clock.month,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function zonedInstant(
  year: number,
  month: number,
  date: number,
  hour: number,
  timeZone: string,
  minute = 0,
  second = 0,
) {
  const guess = utcCalendarInstant(year, month, date, hour, minute, second);
  const first = guess - offset(guess, timeZone);
  return guess - offset(first, timeZone);
}

function dayNumber(instant: number, timeZone: string) {
  const clock = wallClock(instant, timeZone);
  return utcCalendarInstant(clock.year, clock.month, clock.day) / day;
}

export function zonedDayBounds(instant: number, timeZone: string) {
  const clock = wallClock(instant, timeZone);
  return [
    zonedInstant(clock.year, clock.month, clock.day, 0, timeZone),
    zonedInstant(clock.year, clock.month, clock.day + 1, 0, timeZone),
  ] as const;
}

export function nextWorkingMorning(now: number, timeZone: string) {
  const today = wallClock(now, timeZone);
  const ahead = today.weekday === 5 ? 3 : today.weekday === 6 ? 2 : 1;
  const target = new Date(
    utcCalendarInstant(today.year, today.month, today.day + ahead),
  );
  return zonedInstant(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    9,
    timeZone,
  );
}

const pad = (value: number) => String(value).padStart(2, "0");

export function preciseDateLabel(value: string, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    timeZone,
  }).format(new Date(value));
}

export function zonedInputValue(
  value: string,
  timeZone: string,
  precise = false,
) {
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return "";
  const clock = wallClock(instant, timeZone);
  const date = new Date(instant);
  const seconds = precise
    ? `:${pad(clock.second)}${date.getUTCMilliseconds() ? `.${String(date.getUTCMilliseconds()).padStart(3, "0")}` : ""}`
    : "";
  return `${String(clock.year).padStart(4, "0")}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}${seconds}`;
}

export function instantFromZonedInput(value: string, timeZone: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const milliseconds = Number((match[7] ?? "").padEnd(3, "0"));
  if (
    year < 1 ||
    month < 1 ||
    date < 1 ||
    month > 12 ||
    date > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return "";
  let instant: number;
  try {
    instant =
      zonedInstant(year, month, date, hour, timeZone, minute, second) +
      milliseconds;
  } catch {
    return "";
  }
  const actual = wallClock(instant, timeZone);
  // Invalid calendar dates and nonexistent DST wall-clock times are never normalized silently.
  if (
    actual.year !== year ||
    actual.month !== month ||
    actual.day !== date ||
    actual.hour !== hour ||
    actual.minute !== minute ||
    actual.second !== second
  )
    return "";
  return new Date(instant).toISOString();
}

export function dueToday(dueAt: string, now: number, timeZone: string) {
  return dayNumber(Date.parse(dueAt), timeZone) <= dayNumber(now, timeZone);
}

export function overdueDay(dueAt: string, now: number, timeZone: string) {
  return dayNumber(Date.parse(dueAt), timeZone) < dayNumber(now, timeZone);
}

export function snoozeLabel(target: number, now: number, timeZone: string) {
  if (dayNumber(target, timeZone) - dayNumber(now, timeZone) === 1)
    return t.snoozeTomorrow;
  return t.weekdays[wallClock(target, timeZone).weekday] ?? t.snoozeTomorrow;
}
