import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as s from "../database/schema";

/** The same business filters are accepted by HTTP and MCP list operations. */
export const recordFilterFields = {
  query: z.string().trim().max(200).default(""),
  tag: z.string().trim().max(50).optional(),
  ownerId: z.string().min(1).max(200).optional(),
  qualification: z.string().trim().min(1).max(100).optional(),
  status: z
    .enum([
      "open",
      "completed",
      "blocked",
      "won",
      "lost",
      "scheduled",
      "held",
      "canceled",
      "draft",
      "approved",
      "archived",
      "planned",
      "drafted",
      "sent",
      "skipped",
      "expired",
      "paused",
    ])
    .optional(),
  size: z.enum(["known", "unknown"]).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  minimum: z.coerce
    .number()
    .int()
    .min(0)
    .max(2147483647)
    .optional()
    .describe(
      "Inclusive minimum amount in integer currency minor units: USD cents, JPY yen, KWD thousandths. Ranges use the supplied currency or USD by default and exclude unknown amounts. Zero is valid.",
    ),
  maximum: z.coerce
    .number()
    .int()
    .min(0)
    .max(2147483647)
    .optional()
    .describe(
      "Inclusive maximum amount in integer currency minor units, using the supplied currency or USD by default. Excludes unknown amounts. Must be at least minimum when both are supplied; zero is valid.",
    ),
  sort: z
    .enum(["default", "name", "name_desc", "amount_desc", "amount_asc"])
    .default("default"),
};
export type RecordFilterInput = {
  tag?: string;
  ownerId?: string;
  qualification?: string;
  status?: string;
  size?: "known" | "unknown";
  currency?: string;
  minimum?: number;
  maximum?: number;
};
export interface SqlRecordFacts {
  tags?: SQL;
  amount?: SQL;
  currency?: SQL;
  owner?: SQL;
  qualification?: SQL;
  status?: SQL;
}

/** Metadata inheritance follows useRecordIndex: relationship, person, company. */
export function relationshipFactSql(
  relationshipId: SQL,
  organizationId: string,
  productIds: string[],
): SqlRecordFacts {
  const r = alias(s.relationships, "filter_relationship");
  const p = alias(s.people, "filter_person");
  const c = alias(s.companies, "filter_company");
  const from = sql`FROM ${s.relationships} AS filter_relationship INNER JOIN ${s.people} AS filter_person ON ${p.id} = ${r.personId} AND ${p.organizationId} = ${r.organizationId} LEFT JOIN ${s.companies} AS filter_company ON ${c.id} = ${p.companyId} AND ${c.organizationId} = ${r.organizationId} AND ${c.archivedAt} IS NULL WHERE ${and(eq(r.id, relationshipId), eq(r.organizationId, organizationId), inArray(r.productId, productIds), isNull(p.archivedAt))}`;
  const scalar = (value: SQL) => sql`(SELECT ${value} ${from})`;
  return {
    tags: scalar(
      sql`${r.tags} || ${p.tags} || coalesce(${c.tags}, '[]'::jsonb)`,
    ),
    amount: scalar(
      sql`coalesce(${r.amountMinor}, ${p.amountMinor}, ${c.amountMinor})`,
    ),
    currency: sql`coalesce(${scalar(
      sql`CASE WHEN ${r.amountMinor} IS NOT NULL THEN ${r.currency} WHEN ${p.amountMinor} IS NOT NULL THEN ${p.currency} WHEN ${c.amountMinor} IS NOT NULL THEN ${c.currency} ELSE 'USD' END`,
    )}, 'USD')`,
    owner: scalar(sql`${r.ownerId}`),
    qualification: scalar(sql`${r.qualification}`),
  };
}

export function recordFactConditions(
  input: RecordFilterInput,
  facts: SqlRecordFacts,
) {
  const conditions: SQL[] = [];
  if (input.tag && facts.tags)
    conditions.push(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(${facts.tags}, '[]'::jsonb)) AS tag(value) WHERE lower(tag.value) = ${input.tag.toLowerCase()})`,
    );
  if (input.ownerId && facts.owner)
    conditions.push(sql`${facts.owner} = ${input.ownerId}`);
  if (input.qualification && facts.qualification)
    conditions.push(sql`${facts.qualification} = ${input.qualification}`);
  if (input.status && facts.status)
    conditions.push(sql`${facts.status} = ${input.status}`);
  if (facts.amount) {
    if (input.size === "known")
      conditions.push(sql`${facts.amount} IS NOT NULL`);
    if (input.size === "unknown") conditions.push(sql`${facts.amount} IS NULL`);
    if (input.minimum !== undefined)
      conditions.push(sql`${facts.amount} >= ${input.minimum}`);
    if (input.maximum !== undefined)
      conditions.push(sql`${facts.amount} <= ${input.maximum}`);
  }
  if (
    facts.currency &&
    (input.currency ||
      input.minimum !== undefined ||
      input.maximum !== undefined)
  )
    conditions.push(sql`${facts.currency} = ${input.currency ?? "USD"}`);
  return conditions;
}
