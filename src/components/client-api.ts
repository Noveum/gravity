import t from "@crm/i18n/translations/en.json";

export async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.code === "string"
          ? data.code
          : response.status === 429
            ? "RATE_LIMITED"
            : "INTERNAL_ERROR",
    );
  return data;
}
export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  return t.errors[code as keyof typeof t.errors] ?? t.errors.NETWORK_ERROR;
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
  timezone: string;
}
