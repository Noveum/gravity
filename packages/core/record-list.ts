import {
  and,
  asc,
  count,
  eq,
  exists,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { scopeSchema } from "./crm";
import { authorize, type Principal } from "./policy";

export const recordListSchema = scopeSchema
  .extend({
    entity: z.enum([
      "people",
      "companies",
      "relationships",
      "opportunities",
      "meetings",
      "sequences",
      "folders",
      "assets",
      "actions",
    ]),
    query: z.string().trim().max(200).default(""),
    tag: z.string().trim().max(50).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    minimum: z.coerce.number().int().min(0).max(2147483647).optional(),
    maximum: z.coerce.number().int().min(0).max(2147483647).optional(),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(
    (input) =>
      input.minimum === undefined ||
      input.maximum === undefined ||
      input.minimum <= input.maximum,
  )
  .refine(
    (input) =>
      ["people", "companies", "relationships", "opportunities"].includes(
        input.entity,
      ) ||
      (!input.tag &&
        !input.currency &&
        input.minimum === undefined &&
        input.maximum === undefined),
  );

export class RecordListService {
  constructor(private db: Database) {}

  async page(principal: Principal, input: z.infer<typeof recordListSchema>) {
    const permission = await authorize(
      this.db,
      principal,
      input.organizationId,
      input.productId,
    );
    const ids = permission.products
      .filter((product) => !input.productId || product.id === input.productId)
      .map((product) => product.id);
    const tables = {
      people: s.people,
      companies: s.companies,
      relationships: s.relationships,
      opportunities: s.opportunities,
      meetings: s.meetings,
      sequences: s.sequences,
      folders: s.folders,
      assets: s.assets,
      actions: s.actions,
    };
    const table = tables[input.entity];
    const conditions: (SQL | undefined)[] = [
      eq(table.organizationId, input.organizationId),
    ];
    const personRelationships = (personId: typeof s.people.id) =>
      this.db
        .select({ id: s.relationships.id })
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.organizationId, input.organizationId),
            eq(s.relationships.personId, personId),
            inArray(s.relationships.productId, ids),
          ),
        );
    const companyPeople = (active: boolean, permitted: boolean) =>
      this.db
        .select({ id: s.people.id })
        .from(s.people)
        .where(
          and(
            eq(s.people.organizationId, input.organizationId),
            eq(s.people.companyId, s.companies.id),
            active ? isNull(s.people.archivedAt) : undefined,
            permitted ? exists(personRelationships(s.people.id)) : undefined,
          ),
        );
    if (input.entity === "people")
      conditions.push(
        isNull(s.people.archivedAt),
        exists(personRelationships(s.people.id)),
      );
    if (input.entity === "companies")
      conditions.push(
        isNull(s.companies.archivedAt),
        or(
          exists(companyPeople(true, true)),
          and(
            notExists(companyPeople(true, false)),
            or(
              notExists(companyPeople(false, false)),
              exists(companyPeople(false, true)),
            ),
          ),
        ),
      );
    if ("productId" in table) conditions.push(inArray(table.productId, ids));
    if (input.entity === "relationships")
      conditions.push(
        exists(
          this.db
            .select({ id: s.people.id })
            .from(s.people)
            .where(
              and(
                eq(s.people.id, s.relationships.personId),
                eq(s.people.organizationId, input.organizationId),
                isNull(s.people.archivedAt),
              ),
            ),
        ),
      );
    if ("relationshipId" in table)
      conditions.push(
        exists(
          this.db
            .select({ id: s.relationships.id })
            .from(s.relationships)
            .innerJoin(s.people, eq(s.people.id, s.relationships.personId))
            .where(
              and(
                eq(s.relationships.id, table.relationshipId),
                eq(s.relationships.organizationId, input.organizationId),
                eq(s.people.organizationId, input.organizationId),
                isNull(s.people.archivedAt),
              ),
            ),
        ),
      );
    if (input.entity === "actions")
      conditions.push(
        or(
          isNull(s.actions.sourceConversationId),
          exists(
            this.db
              .select({ id: s.conversations.id })
              .from(s.conversations)
              .where(
                and(
                  eq(s.conversations.id, s.actions.sourceConversationId),
                  eq(s.conversations.organizationId, input.organizationId),
                  inArray(s.conversations.productId, ids),
                  or(
                    eq(s.conversations.visibility, "product"),
                    eq(s.conversations.ownerId, principal.userId),
                  ),
                ),
              ),
          ),
        ),
      );
    const label =
      "name" in table
        ? table.name
        : "title" in table
          ? table.title
          : s.relationships.nextStep;
    if (input.query) {
      const term = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
      const alternatives: (SQL | undefined)[] = [ilike(label, term)];
      if (input.entity === "people")
        alternatives.push(
          ilike(s.people.title, term),
          ilike(s.people.email, term),
          exists(
            this.db
              .select({ id: s.companies.id })
              .from(s.companies)
              .where(
                and(
                  eq(s.companies.id, s.people.companyId),
                  eq(s.companies.organizationId, input.organizationId),
                  ilike(s.companies.name, term),
                ),
              ),
          ),
        );
      if (input.entity === "companies")
        alternatives.push(ilike(s.companies.domain, term));
      if (input.entity === "relationships" || "relationshipId" in table) {
        const related = alias(s.relationships, "searched_relationship");
        const relationshipId =
          "relationshipId" in table ? table.relationshipId : s.relationships.id;
        alternatives.push(
          exists(
            this.db
              .select({ id: s.people.id })
              .from(s.people)
              .innerJoin(related, eq(related.personId, s.people.id))
              .leftJoin(
                s.companies,
                and(
                  eq(s.companies.id, s.people.companyId),
                  eq(s.companies.organizationId, input.organizationId),
                ),
              )
              .where(
                and(
                  eq(related.id, relationshipId),
                  eq(related.organizationId, input.organizationId),
                  eq(s.people.organizationId, input.organizationId),
                  or(
                    ilike(s.people.name, term),
                    ilike(s.people.title, term),
                    ilike(s.companies.name, term),
                  ),
                ),
              ),
          ),
        );
      }
      conditions.push(or(...alternatives));
    }
    if ("tags" in table && input.tag)
      conditions.push(
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${table.tags}) AS tag(value) WHERE lower(tag.value) = ${input.tag.toLowerCase()})`,
      );
    if ("amountMinor" in table) {
      if (input.currency) conditions.push(eq(table.currency, input.currency));
      if (input.minimum !== undefined || input.maximum !== undefined)
        conditions.push(eq(table.currency, input.currency ?? "USD"));
      if (input.minimum !== undefined)
        conditions.push(sql`${table.amountMinor} >= ${input.minimum}`);
      if (input.maximum !== undefined)
        conditions.push(sql`${table.amountMinor} <= ${input.maximum}`);
    }
    const where = and(...conditions);
    const columns =
      input.entity === "assets"
        ? {
            id: s.assets.id,
            organizationId: s.assets.organizationId,
            productId: s.assets.productId,
            folderId: s.assets.folderId,
            name: s.assets.name,
            mimeType: s.assets.mimeType,
            size: s.assets.size,
            status: s.assets.status,
            version: s.assets.version,
            createdAt: s.assets.createdAt,
          }
        : getTableColumns(table);
    const [items, totals] = await Promise.all([
      this.db
        .select(columns)
        .from(table)
        .where(where)
        .orderBy(asc(label), asc(table.id))
        .limit(input.limit)
        .offset(input.offset),
      this.db.select({ total: count() }).from(table).where(where),
    ]);
    const total = totals[0]?.total ?? 0;
    return {
      items,
      total,
      nextOffset:
        input.offset + input.limit < total ? input.offset + input.limit : null,
      asOf: new Date().toISOString(),
    };
  }
}
