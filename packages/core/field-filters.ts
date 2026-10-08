import { z } from "zod";
import { preciseInstantSchema } from "./datetime";
import { fieldTextCaseSources, fieldTextCaseTargets } from "./field-text-case";
import { fieldKinds, type RelationshipField } from "./relationship-context";

export const fieldOperators = [
  "eq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "missing",
] as const;
export const fieldFilterSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    type: z.enum(fieldKinds),
    operator: z.enum(fieldOperators),
    value: z
      .union([z.string().max(10000), z.number().finite(), z.boolean()])
      .optional(),
  })
  .refine((filter) => {
    if (filter.operator === "exists" || filter.operator === "missing")
      return filter.value === undefined;
    if (
      filter.operator === "contains" &&
      !["text", "url"].includes(filter.type)
    )
      return false;
    if (
      ["gt", "gte", "lt", "lte"].includes(filter.operator) &&
      !["number", "date", "datetime"].includes(filter.type)
    )
      return false;
    switch (filter.type) {
      case "boolean":
        return typeof filter.value === "boolean";
      case "number":
        return typeof filter.value === "number";
      case "date":
        return z.iso.date().safeParse(filter.value).success;
      case "datetime":
        return preciseInstantSchema.safeParse(filter.value).success;
      default:
        return typeof filter.value === "string";
    }
  });
const filterArray = z.array(fieldFilterSchema).max(10);
export const fieldFiltersSchema = z
  .union([
    filterArray,
    z
      .string()
      .max(20000)
      .transform((value, context) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          context.addIssue({
            code: "custom",
            message: "Invalid field filters",
          });
          return z.NEVER;
        }
      })
      .pipe(filterArray),
  ])
  .default([]);
export type FieldFilter = z.infer<typeof fieldFilterSchema>;
// Match String.trim() when filtering older stored labels that were not normalized.
export const fieldLabelWhitespace =
  " \t\n\r\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
const lowerCharacters = Array.from(fieldTextCaseTargets);
const fieldTextCaseMap = new Map(
  Array.from(fieldTextCaseSources, (character, index) => [
    character,
    lowerCharacters[index] ?? character,
  ]),
);
// Use the same fixed character mapping as SQL translate, including supplementary
// characters, without contextual sigma or dotted-I expansion.
export const normalizeFieldText = (value: string) =>
  Array.from(
    value,
    (character) => fieldTextCaseMap.get(character) ?? character,
  ).join("");
export const normalizeFieldLabel = (value: string) =>
  normalizeFieldText(value.trim());
export function fieldFilterOperators(type: RelationshipField["type"]) {
  return fieldOperators
    .filter(
      (operator) =>
        operator !== "contains" || type === "text" || type === "url",
    )
    .filter(
      (operator) =>
        !["gt", "gte", "lt", "lte"].includes(operator) ||
        ["number", "date", "datetime"].includes(type),
    );
}
export function matchesFieldFilters(
  fields: readonly RelationshipField[],
  filters: readonly FieldFilter[],
) {
  return filters.every((filter) => {
    const candidates = fields.filter(
      (field) =>
        field.type === filter.type &&
        normalizeFieldLabel(field.label) === normalizeFieldLabel(filter.label),
    );
    if (filter.operator === "exists") return candidates.length > 0;
    if (filter.operator === "missing") return candidates.length === 0;
    return candidates.some((field) => {
      const actual =
        field.type === "datetime"
          ? Date.parse(String(field.value))
          : typeof field.value === "string"
            ? normalizeFieldText(field.value)
            : field.value;
      const expected =
        filter.type === "datetime"
          ? Date.parse(String(filter.value))
          : typeof filter.value === "string"
            ? normalizeFieldText(filter.value)
            : filter.value;
      if (expected === undefined) return false;
      switch (filter.operator) {
        case "eq":
          return actual === expected;
        case "contains":
          return String(actual).includes(String(expected));
        case "gt":
          return actual > expected;
        case "gte":
          return actual >= expected;
        case "lt":
          return actual < expected;
        case "lte":
          return actual <= expected;
        default:
          return false;
      }
    });
  });
}
