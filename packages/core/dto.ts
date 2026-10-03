import type { CompanyContext, PersonContext, Snapshot } from "./crm";
export type JsonValue<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? JsonValue<U>[]
    : T extends object
      ? { [K in keyof T]: JsonValue<T[K]> }
      : T;
export type ClientSnapshot = JsonValue<Snapshot>;
export type ClientContext = JsonValue<PersonContext>;
export function serialize<T>(value: T): JsonValue<T> {
  return JSON.parse(JSON.stringify(value));
}

export type ClientCompanyContext = JsonValue<CompanyContext>;
