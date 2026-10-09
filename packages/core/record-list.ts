import {
  and,
  asc,
  count,
  desc,
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
import { readableAttribution } from "./contact-attribution";
import { scopeSchema } from "./crm";
import { fieldFilterConditions } from "./field-filter-sql";
import { fieldFiltersSchema } from "./field-filters";
import { authorize, type Principal } from "./policy";
import {
  recordFactConditions,
  recordFilterFields,
  relationshipFactSql,
  type SqlRecordFacts,
} from "./record-filters";

const recordListObject = scopeSchema.extend({
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
  submittedBy: z.string().min(1).max(200).optional(),
  sourceMemberId: z.string().min(1).max(200).optional(),
  attribution: z.enum(["recorded", "unknown", "shared"]).optional(),
  ...recordFilterFields,
  fieldFilters: fieldFiltersSchema,
  pipelineId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  kind: z
    .enum(["reply", "approval", "review", "commitment", "research"])
    .optional(),
  owedBy: z.enum(["us", "them", "unknown"]).optional(),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const recordListSchema = recordListObject
  .refine(
    (input) =>
      input.entity === "people" ||
      (!input.submittedBy && !input.sourceMemberId && !input.attribution),
  )
  .refine(
    (input) =>
      !input.fieldFilters.length ||
      [
        "people",
        "companies",
        "relationships",
        "opportunities",
        "meetings",
        "actions",
      ].includes(input.entity),
  )
  .refine(
    (input) =>
      input.minimum === undefined ||
      input.maximum === undefined ||
      input.minimum <= input.maximum,
  )
  .refine(
    (input) =>
      [
        "people",
        "companies",
        "relationships",
        "opportunities",
        "actions",
        "meetings",
      ].includes(input.entity) ||
      (!input.tag &&
        !input.currency &&
        input.minimum === undefined &&
        input.maximum === undefined &&
        !input.size &&
        !input.qualification &&
        !input.ownerId &&
        !input.sort.startsWith("amount_")),
  )
  .refine(
    (input) =>
      !input.pipelineId ||
      ["relationships", "opportunities"].includes(input.entity),
  )
  .refine(
    (input) =>
      !input.stageId ||
      ["relationships", "opportunities"].includes(input.entity),
  )
  .refine(
    (input) => (!input.kind && !input.owedBy) || input.entity === "actions",
  )
  .refine(
    (input) =>
      !input.status ||
      (input.entity === "actions" &&
        ["open", "completed", "blocked"].includes(input.status)) ||
      (input.entity === "meetings" &&
        ["scheduled", "held", "canceled"].includes(input.status)) ||
      (input.entity === "opportunities" &&
        ["open", "won", "lost"].includes(input.status)) ||
      (input.entity === "assets" &&
        ["draft", "approved", "archived"].includes(input.status)),
  )
  .refine((input) => !input.ownerId || input.entity !== "companies")
  .refine((input) => !input.qualification || input.entity !== "companies");

export const nextActionsSchema = recordListObject
  .omit({
    entity: true,
    pipelineId: true,
    stageId: true,
    submittedBy: true,
    sourceMemberId: true,
    attribution: true,
  })
  .extend({
    includeCompleted: z.enum(["true", "false"]).default("false"),
    status: z.enum(["open", "completed", "blocked"]).optional(),
  })
  .refine(
    (input) =>
      input.minimum === undefined ||
      input.maximum === undefined ||
      input.minimum <= input.maximum,
  );

export class RecordListService {
  constructor(private db: Database) {}

  async page(
    principal: Principal,
    input: z.infer<typeof recordListSchema>,
    pendingOnly = false,
  ) {
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
    if (input.entity === "opportunities")
      conditions.push(isNull(s.opportunities.archivedAt));
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
    if (
      input.entity === "people" &&
      (input.submittedBy || input.sourceMemberId || input.attribution)
    ) {
      const contributions = (filter?: SQL) =>
        this.db
          .select({ id: s.contactContributions.id })
          .from(s.contactContributions)
          .where(
            and(
              readableAttribution(principal, input.organizationId, ids),
              eq(s.contactContributions.personId, s.people.id),
              inArray(s.contactContributions.kind, [
                "created",
                "submitted",
                "provider_import",
              ]),
              filter,
            ),
          );
      conditions.push(
        input.attribution === "unknown"
          ? notExists(contributions())
          : exists(contributions()),
      );
      // Match people who have each contribution anywhere in their visible history,
      // consistently with the UI's independent contributor filters.
      if (input.submittedBy)
        conditions.push(
          exists(
            contributions(
              eq(s.contactContributions.actorId, input.submittedBy),
            ),
          ),
        );
      if (input.sourceMemberId)
        conditions.push(
          exists(
            contributions(
              eq(s.contactContributions.sourceMemberId, input.sourceMemberId),
            ),
          ),
        );
      if (input.attribution === "shared")
        conditions.push(
          sql`(SELECT count(DISTINCT contributor) FROM ${s.contactContributions} CROSS JOIN LATERAL (VALUES (${s.contactContributions.actorId}),(${s.contactContributions.sourceMemberId})) AS members(contributor) WHERE ${s.contactContributions.personId}=${s.people.id} AND ${readableAttribution(principal, input.organizationId, ids)} AND ${inArray(s.contactContributions.kind, ["created", "submitted", "provider_import"])} AND contributor IS NOT NULL) > 1`,
        );
    }
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
    if (input.fieldFilters.length) {
      const filteredRelationship = alias(s.relationships, "field_relationship");
      const relationshipConditions: (SQL | undefined)[] = [
        eq(filteredRelationship.organizationId, input.organizationId),
        inArray(filteredRelationship.productId, ids),
        ...fieldFilterConditions(
          sql`${filteredRelationship.contextDetails}`,
          input.fieldFilters,
        ),
      ];
      if (input.entity === "relationships")
        relationshipConditions.push(
          eq(filteredRelationship.id, s.relationships.id),
        );
      else if (input.entity === "people")
        relationshipConditions.push(
          eq(filteredRelationship.personId, s.people.id),
        );
      else if (input.entity === "companies")
        relationshipConditions.push(
          exists(
            this.db
              .select({ id: s.people.id })
              .from(s.people)
              .where(
                and(
                  eq(s.people.id, filteredRelationship.personId),
                  eq(s.people.organizationId, input.organizationId),
                  eq(s.people.companyId, s.companies.id),
                  isNull(s.people.archivedAt),
                ),
              ),
          ),
        );
      else if ("relationshipId" in table)
        relationshipConditions.push(
          eq(filteredRelationship.id, table.relationshipId),
        );
      conditions.push(
        exists(
          this.db
            .select({ id: filteredRelationship.id })
            .from(filteredRelationship)
            .where(and(...relationshipConditions)),
        ),
      );
    }
    const label =
      "name" in table
        ? table.name
        : "title" in table
          ? table.title
          : s.relationships.nextStep;
    // Relationship cards identify the person; next-step text remains searchable.
    const sortLabel =
      input.entity === "relationships"
        ? sql`(SELECT ${s.people.name} FROM ${s.people} WHERE ${s.people.id} = ${s.relationships.personId} AND ${s.people.organizationId} = ${input.organizationId} AND ${s.people.archivedAt} IS NULL)`
        : label;
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
      if (input.entity === "meetings")
        alternatives.push(ilike(s.meetings.summary, term));
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
    let facts: SqlRecordFacts = {
      ...("tags" in table ? { tags: sql`${table.tags}` } : {}),
      ...("amountMinor" in table
        ? {
            amount: sql`${table.amountMinor}`,
            currency: sql`${table.currency}`,
          }
        : {}),
      ...("status" in table ? { status: sql`${table.status}` } : {}),
    };
    if (input.entity === "relationships" || "relationshipId" in table) {
      const relationshipId =
        "relationshipId" in table
          ? sql`${table.relationshipId}`
          : sql`${s.relationships.id}`;
      const inherited = relationshipFactSql(
        relationshipId,
        input.organizationId,
        ids,
      );
      facts = { ...inherited, ...facts };
      if (input.entity === "relationships") facts = inherited;
      if (input.entity === "opportunities") {
        facts.tags = sql`coalesce(${inherited.tags}, '[]'::jsonb) || ${s.opportunities.tags}`;
        facts.owner = sql`coalesce(${s.opportunities.ownerId}, ${inherited.owner})`;
      }
      if (input.entity === "actions") facts.owner = sql`${s.actions.ownerId}`;
    }
    if (input.entity === "people") {
      const relatedFilter = (condition: SQL) =>
        exists(
          this.db
            .select({ id: s.relationships.id })
            .from(s.relationships)
            .where(
              and(
                eq(s.relationships.organizationId, input.organizationId),
                eq(s.relationships.personId, s.people.id),
                inArray(s.relationships.productId, ids),
                condition,
              ),
            ),
        );
      if (input.ownerId)
        conditions.push(
          relatedFilter(eq(s.relationships.ownerId, input.ownerId)),
        );
      if (input.qualification)
        conditions.push(
          relatedFilter(eq(s.relationships.qualification, input.qualification)),
        );
    }
    conditions.push(...recordFactConditions(input, facts));
    if (
      (input.entity === "opportunities" || input.entity === "relationships") &&
      input.stageId
    )
      conditions.push(
        eq(
          input.entity === "opportunities"
            ? s.opportunities.stageId
            : s.relationships.stageId,
          input.stageId,
        ),
      );
    if (
      (input.entity === "opportunities" || input.entity === "relationships") &&
      input.pipelineId
    ) {
      const stageId =
        input.entity === "opportunities"
          ? s.opportunities.stageId
          : s.relationships.stageId;
      conditions.push(
        exists(
          this.db
            .select({ id: s.stages.id })
            .from(s.stages)
            .where(
              and(
                eq(s.stages.id, stageId),
                eq(s.stages.organizationId, input.organizationId),
                eq(s.stages.pipelineId, input.pipelineId),
                inArray(s.stages.productId, ids),
              ),
            ),
        ),
      );
    }
    if (input.entity === "actions") {
      if (input.kind) conditions.push(eq(s.actions.kind, input.kind));
      if (input.owedBy) conditions.push(eq(s.actions.owedBy, input.owedBy));
      if (pendingOnly) conditions.push(sql`${s.actions.status} <> 'completed'`);
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
    const defaultOrder =
      input.entity === "actions"
        ? [asc(s.actions.dueAt), asc(table.id)]
        : input.entity === "meetings"
          ? [desc(s.meetings.startsAt), asc(table.id)]
          : ["people", "relationships", "opportunities"].includes(input.entity)
            ? [asc(table.id)]
            : [asc(label), asc(table.id)];
    const order =
      input.sort === "default"
        ? defaultOrder
        : input.sort.startsWith("amount_") && facts.amount && facts.currency
          ? [
              sql`${facts.amount} IS NULL ASC`,
              asc(facts.currency),
              input.sort === "amount_desc"
                ? desc(facts.amount)
                : asc(facts.amount),
              asc(sortLabel),
              asc(table.id),
            ]
          : [
              input.sort === "name_desc" ? desc(sortLabel) : asc(sortLabel),
              asc(table.id),
            ];
    const [items, totals] = await Promise.all([
      this.db
        .select(columns)
        .from(table)
        .where(where)
        .orderBy(...order)
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
