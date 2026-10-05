import t from "@crm/i18n/translations/en.json";

export class RequestError extends Error {
  constructor(
    code: string,
    public details: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

export async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok)
    throw new RequestError(
      typeof data.error === "string"
        ? data.error
        : typeof data.code === "string"
          ? data.code
          : response.status === 429
            ? "RATE_LIMITED"
            : "INTERNAL_ERROR",
      typeof data.details === "object" && data.details ? data.details : {},
    );
  return data;
}
const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export function detailText(value: string | number, timeZone = "UTC") {
  return typeof value === "string" &&
    isoTime.test(value) &&
    !Number.isNaN(Date.parse(value))
    ? dateLabel(value, timeZone)
    : String(value);
}
export function errorText(error: unknown, timeZone = "UTC") {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const message =
    t.errors[code as keyof typeof t.errors] ?? t.errors.NETWORK_ERROR;
  const details = error instanceof RequestError ? error.details : {};
  return message.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = details[key];
    return value === undefined ? match : detailText(value, timeZone);
  });
}
export const label = (key: string) => {
  const value = t[key as keyof typeof t];
  return typeof value === "string" ? value : key;
};
export function dateLabel(value: string, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}
