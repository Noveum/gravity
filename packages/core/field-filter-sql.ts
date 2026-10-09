import { type SQL, sql } from "drizzle-orm";
import {
  type FieldFilter,
  fieldLabelWhitespace,
  normalizeFieldLabel,
  normalizeFieldText,
} from "./field-filters";
import { fieldTextCaseSources, fieldTextCaseTargets } from "./field-text-case";

function normalizedFieldSql(value: SQL) {
  // Keep ASCII fast while matching the UI's fixed Unicode case mapping.
  return sql`CASE WHEN octet_length(${value}) = char_length(${value}) THEN translate(${value}, ${fieldTextCaseSources.slice(0, 26)}, ${fieldTextCaseTargets.slice(0, 26)}) ELSE translate(${value}, ${fieldTextCaseSources}, ${fieldTextCaseTargets}) END`;
}

/** Predicates for one already-authorized relationship's visible fields. */
export function fieldFilterConditions(
  contextDetails: SQL,
  filters: readonly FieldFilter[],
): SQL[] {
  return filters.map((filter) => {
    const matchingName = sql`${normalizedFieldSql(sql`btrim(field.value->>'label', ${fieldLabelWhitespace})`)} = ${normalizeFieldLabel(filter.label)} AND field.value->>'type' = ${filter.type}`;
    const stored =
      filter.type === "number"
        ? sql`CASE WHEN jsonb_typeof(field.value->'value') = 'number' THEN (field.value->>'value')::numeric END`
        : filter.type === "datetime"
          ? sql`CASE WHEN field.value->>'type' = 'datetime' THEN (field.value->>'value')::timestamptz END`
          : filter.type === "text" || filter.type === "url"
            ? normalizedFieldSql(sql`field.value->>'value'`)
            : sql`field.value->>'value'`;
    const expected =
      typeof filter.value === "string"
        ? normalizeFieldText(filter.value)
        : typeof filter.value === "boolean"
          ? String(filter.value)
          : filter.value;
    let comparison: SQL | undefined;
    if (filter.operator === "eq") comparison = sql`${stored} = ${expected}`;
    if (filter.operator === "contains")
      comparison = sql`position(${expected} in ${stored}) > 0`;
    if (filter.operator === "gt") comparison = sql`${stored} > ${expected}`;
    if (filter.operator === "gte") comparison = sql`${stored} >= ${expected}`;
    if (filter.operator === "lt") comparison = sql`${stored} < ${expected}`;
    if (filter.operator === "lte") comparison = sql`${stored} <= ${expected}`;
    const matching = sql`EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(${contextDetails}->'fields', '[]'::jsonb)) AS field(value) WHERE ${matchingName}${comparison ? sql` AND ${comparison}` : sql``})`;
    return filter.operator === "missing" ? sql`NOT (${matching})` : matching;
  });
}
