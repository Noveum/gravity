import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import t from "../i18n/translations/en.json";
import { overview as calculateOverview } from "./analytics";
import { draftHash, draftSubject } from "./drafts";
import { serialize } from "./dto";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import {
  activeCompany,
  assertActiveRelationships,
  companyVisible,
  emailTaken,
  personVisible,
} from "./visibility";
import { ianaTimeZoneSchema } from "./workspace";

export const scopeSchema = z.object({
  organizationId: z.uuid(),
  productId: z.uuid().optional(),
});
export const actionChangeSchema = scopeSchema.extend({
  actionId: z.uuid(),
  version: z.number().int().positive(),
  command: z.enum(["save", "approve", "complete", "rework"]),
  draft: z.string().max(20000).optional(),
});
export const actionPlanSchema = scopeSchema.extend({
  items: z
    .array(
      z
        .object({
          actionId: z.uuid(),
          version: z.number().int().positive(),
          status: z.enum(["open", "completed"]).optional(),
          dueAt: z.iso.datetime().optional(),
          ownerId: z.string().min(1).optional(),
        })
        .refine(
          (item) =>
            item.status !== undefined ||
            item.dueAt !== undefined ||
            item.ownerId !== undefined,
        ),
    )
    .min(1)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => item.actionId)).size === items.length,
    ),
});
export const scheduleActionSchema = scopeSchema.extend({
  relationshipId: z.uuid(),
  ownerId: z.string().min(1),
  kind: z.enum(["reply", "approval", "review", "commitment", "research"]),
  channel: z.enum(["gmail", "linkedin", "research"]),
  owedBy: z.enum(["us", "them", "unknown"]),
  title: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(10000).default(""),
  dueAt: z.iso.datetime(),
});
export const folderSchema = scopeSchema.extend({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  parentId: z.uuid().optional(),
});
export const meetingChangeSchema = scopeSchema.extend({
  meetingId: z.uuid(),
  version: z.number().int().positive(),
  dueAt: z.iso.datetime(),
  ownerId: z.string().min(1),
});
export const personSchema = scopeSchema
  .extend({
    productId: z.uuid(),
    personId: z.uuid().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    email: z.email().max(254).optional(),
    title: z.string().trim().max(150).default(""),
    companyId: z.uuid().optional(),
    purpose: z.enum(["buyer", "partner"]).default("buyer"),
    context: z.string().trim().max(10000).default(""),
    review: z.boolean().default(true),
    channel: z.enum(["gmail", "linkedin"]).default("gmail"),
  })
  .refine((value) => !!value.personId !== !!value.name, {
    message: "Provide a new name or existing person",
  });
export const opportunitySchema = scopeSchema
  .extend({
    id: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    productId: z.uuid(),
    relationshipId: z.uuid(),
    stageId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    ownerId: z.string().min(1),
    amountMinor: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .default(null),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .refine((value) => {
        try {
          return Intl.supportedValuesOf("currency").includes(value);
        } catch {
          return false;
        }
      }),
    probability: z.number().int().min(0).max(100).nullable().default(null),
    status: z.enum(["open", "won", "lost"]).default("open"),
    expectedCloseDate: z.iso.date().nullable().default(null),
    description: z.string().trim().max(10000).default(""),
    lostReason: z.string().trim().max(2000).default(""),
  })
  .refine((value) => Boolean(value.id) === Boolean(value.version), {
    message: "Updates require an ID and version",
  });
export const pipelineSchema = scopeSchema.extend({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(100),
});
export const messageActivitySchema = scopeSchema
  .extend({
    from: z.iso.date(),
    through: z.iso.date(),
    ownerId: z.string().max(200).optional(),
    channel: z.enum(["gmail", "linkedin"]).optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    page: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .refine((value) => value.from <= value.through, {
    message: "Invalid date range",
  });
export const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  productName: z.string().trim().min(1).max(100),
  timezone: ianaTimeZoneSchema.default("UTC"),
});
export const organizationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: ianaTimeZoneSchema.default("UTC"),
});
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function defaultStages(organizationId: string, productId: string) {
  return [
    { name: t.discovery, category: "open" as const },
    { name: t.evaluation, category: "open" as const },
    { name: t.proposal, category: "open" as const },
    { name: t.won, category: "won" as const },
    { name: t.lost, category: "lost" as const },
  ].map((stage, position) => ({
    organizationId,
    productId,
    position,
    ...stage,
  }));
}
export function outreachStages(organizationId: string, productId: string) {
  const names = t.outreachStages;
  return [
    { name: names.new, category: "open" as const },
    { name: names.researching, category: "open" as const },
    { name: names.contacted, category: "open" as const },
    { name: names.followUp, category: "open" as const },
    { name: names.replied, category: "open" as const },
    { name: names.meeting, category: "open" as const },
    { name: names.won, category: "won" as const },
    { name: names.lost, category: "lost" as const },
    { name: names.notNow, category: "hold" as const },
  ].map((stage, position) => ({
    organizationId,
    productId,
    position,
    pipeline: "outreach" as const,
    ...stage,
  }));
}
async function insertProduct(
  tx: Transaction,
  organizationId: string,
  name: string,
  userId: string,
) {
  const [product] = await tx
    .insert(s.products)
    .values({ organizationId, name })
    .onConflictDoNothing({
      target: [s.products.organizationId, s.products.name],
    })
    .returning();
  if (!product) throw new DomainError("PRODUCT_EXISTS", 409);
  await tx
    .insert(s.folders)
    .values({ organizationId, productId: product.id, name: t.defaultFolder });
  const [pipeline] = await tx
    .insert(s.pipelines)
    .values({ organizationId, productId: product.id, name: t.salesPipeline })
    .returning();
  await tx.insert(s.stages).values([
    ...defaultStages(organizationId, product.id).map((stage) => ({
      ...stage,
      pipelineId: pipeline.id,
    })),
    ...outreachStages(organizationId, product.id),
  ]);
  await tx.insert(s.changeEvents).values({
    organizationId,
    productId: product.id,
    actorId: userId,
    type: "product.created",
    entityId: product.id,
  });
  return product;
}

export class CrmService {
  constructor(private db: Database) {}
  async scheduleAction(
    principal: Principal,
    input: z.infer<typeof scheduleActionSchema>,
  ) {
    if (principal.source === "mcp" && principal.readOnly !== false)
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const [relationship] = await tx
        .select()
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.id, input.relationshipId),
            eq(s.relationships.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (!relationship) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        relationship.productId,
        true,
      );
      if (input.productId && input.productId !== relationship.productId)
        throw new DomainError("FORBIDDEN", 403);
      await assertActiveRelationships(tx, input.organizationId, [
        relationship.id,
      ]);
      await assertProductActive(
        tx,
        input.organizationId,
        relationship.productId,
      );
      // Assignees must currently be able to see the task's product, even if the creator is an admin.
      try {
        await authorize(
          tx,
          { userId: input.ownerId, source: "session" },
          input.organizationId,
          relationship.productId,
        );
      } catch (error) {
        if (error instanceof DomainError)
          throw new DomainError("OWNER_NOT_ALLOWED", 403);
        throw error;
      }
      const [paused] = await tx
        .select({ id: s.enrollments.id })
        .from(s.enrollments)
        .where(
          and(
            eq(s.enrollments.organizationId, input.organizationId),
            eq(s.enrollments.relationshipId, relationship.id),
            eq(s.enrollments.status, "paused"),
            eq(s.enrollments.pauseReason, "reply"),
          ),
        );
      const [action] = await tx
        .insert(s.actions)
        .values({
          organizationId: input.organizationId,
          productId: relationship.productId,
          relationshipId: relationship.id,
          ownerId: input.ownerId,
          kind: input.kind,
          channel: input.channel,
          owedBy: input.owedBy,
          title: input.title,
          reason: input.reason,
          dueAt: new Date(input.dueAt),
          status: input.kind === "approval" && paused ? "blocked" : "open",
        })
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: relationship.productId,
        actorId: principal.userId,
        type: "action.scheduled",
        entityId: action.id,
      });
      return {
        actionId: action.id,
        relationshipId: relationship.id,
        productId: relationship.productId,
      };
    });
  }
  async createPerson(
    principal: Principal,
    input: z.infer<typeof personSchema>,
  ) {
    if (principal.source === "mcp" && principal.readOnly !== false)
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await assertProductActive(tx, input.organizationId, input.productId);
      // Serialize creation within this tenant; explicit linking never silently merges identities.
      await tx
        .select({ id: s.organizations.id })
        .from(s.organizations)
        .where(eq(s.organizations.id, input.organizationId))
        .for("update");
      let personId = input.personId;
      const productIds = permission.products.map((p) => p.id);
      if (personId) {
        const [existing] = await tx
          .select({ archivedAt: s.people.archivedAt })
          .from(s.people)
          .where(
            and(
              eq(s.people.id, personId),
              eq(s.people.organizationId, input.organizationId),
            ),
          );
        if (
          !existing ||
          !(await personVisible(tx, productIds, input.organizationId, personId))
        )
          throw new DomainError("NOT_FOUND", 404);
        if (existing.archivedAt) throw new DomainError("RECORD_ARCHIVED", 409);
      } else if (input.companyId)
        await activeCompany(
          tx,
          productIds,
          input.organizationId,
          input.companyId,
        );
      if (!personId) {
        if (
          input.email &&
          (await emailTaken(tx, input.organizationId, [input.email]))
        )
          throw new DomainError("PERSON_EXISTS", 409);
        const [person] = await tx
          .insert(s.people)
          .values({
            organizationId: input.organizationId,
            name: input.name ?? "",
            title: input.title,
            email: input.email?.toLowerCase(),
            companyId: input.companyId,
          })
          .returning();
        personId = person.id;
      }
      const [firstStage] = await tx
        .select({ id: s.stages.id })
        .from(s.stages)
        .where(
          and(
            eq(s.stages.organizationId, input.organizationId),
            eq(s.stages.productId, input.productId),
            eq(s.stages.pipeline, "outreach"),
            eq(s.stages.category, "open"),
            isNull(s.stages.archivedAt),
          ),
        )
        .orderBy(asc(s.stages.position))
        .limit(1);
      const [relationship] = await tx
        .insert(s.relationships)
        .values({
          organizationId: input.organizationId,
          productId: input.productId,
          personId,
          ownerId: principal.userId,
          purpose: input.purpose,
          context: input.context,
          stageId: firstStage?.id ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (!relationship) throw new DomainError("CONFLICT", 409);
      if (input.review)
        await tx.insert(s.actions).values({
          organizationId: input.organizationId,
          productId: input.productId,
          relationshipId: relationship.id,
          ownerId: principal.userId,
          kind: "research",
          title: t.newPersonAction,
          reason: t.newPersonReason,
          owedBy: "us",
          channel: input.channel,
          dueAt: new Date(),
        });
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: "relationship.created",
        entityId: relationship.id,
      });
      return {
        personId,
        relationshipId: relationship.id,
        productId: input.productId,
      };
    });
  }
  async organizations(principal: Principal) {
    return this.db
      .select({
        id: s.organizations.id,
        name: s.organizations.name,
        slug: s.organizations.slug,
        timezone: s.organizations.timezone,
        allowedEmailDomains: s.organizations.allowedEmailDomains,
      })
      .from(s.organizations)
      .innerJoin(
        s.memberships,
        and(
          eq(s.organizations.id, s.memberships.organizationId),
          eq(s.memberships.userId, principal.userId),
          eq(s.memberships.active, true),
          ...(principal.organizationId
            ? [eq(s.organizations.id, principal.organizationId)]
            : []),
        ),
      )
      .orderBy(asc(s.organizations.name));
  }
  async snapshot(principal: Principal, scope: z.infer<typeof scopeSchema>) {
    const permission = await authorize(
      this.db,
      principal,
      scope.organizationId,
      scope.productId,
    );
    const ids = permission.products
      .filter((p) => !scope.productId || p.id === scope.productId)
      .map((p) => p.id);
    const readableConversations = await this.db
      .select({ id: s.conversations.id })
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.organizationId, scope.organizationId),
          inArray(s.conversations.productId, ids),
          or(
            eq(s.conversations.visibility, "product"),
            eq(s.conversations.ownerId, principal.userId),
          ),
        ),
      );
    const scoped = (table: {
      organizationId: AnyPgColumn;
      productId: AnyPgColumn;
    }) =>
      and(
        eq(table.organizationId, scope.organizationId),
        inArray(table.productId, ids),
      );
    const [organization] = await this.db
      .select({ timezone: s.organizations.timezone })
      .from(s.organizations)
      .where(eq(s.organizations.id, scope.organizationId));
    const messageDay = sql<string>`to_char(${s.messages.occurredAt} AT TIME ZONE ${organization.timezone}, 'YYYY-MM-DD')`;
    const [
      relationships,
      actions,
      sequences,
      enrollments,
      folders,
      assets,
      assetStages,
      stages,
      meetings,
      opportunities,
      members,
      connections,
      grants,
      memberProducts,
      pipelines,
      touchStats,
      messageStats,
    ] = await Promise.all([
      this.db.select().from(s.relationships).where(scoped(s.relationships)),
      this.db
        .select()
        .from(s.actions)
        .where(
          and(
            scoped(s.actions),
            or(
              isNull(s.actions.sourceConversationId),
              inArray(
                s.actions.sourceConversationId,
                readableConversations.map((c) => c.id),
              ),
            ),
          ),
        )
        .orderBy(asc(s.actions.dueAt), asc(s.actions.id)),
      this.db.select().from(s.sequences).where(scoped(s.sequences)),
      this.db.select().from(s.enrollments).where(scoped(s.enrollments)),
      this.db.select().from(s.folders).where(scoped(s.folders)),
      this.db
        .select({
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
        })
        .from(s.assets)
        .where(scoped(s.assets)),
      this.db.select().from(s.assetStages).where(scoped(s.assetStages)),
      this.db
        .select()
        .from(s.stages)
        .where(scoped(s.stages))
        .orderBy(
          asc(s.stages.pipeline),
          asc(s.stages.position),
          asc(s.stages.id),
        ),
      this.db.select().from(s.meetings).where(scoped(s.meetings)),
      this.db.select().from(s.opportunities).where(scoped(s.opportunities)),
      this.db
        .select({ id: s.user.id, name: s.user.name, role: s.memberships.role })
        .from(s.memberships)
        .innerJoin(s.user, eq(s.user.id, s.memberships.userId))
        .where(
          and(
            eq(s.memberships.organizationId, scope.organizationId),
            eq(s.memberships.active, true),
          ),
        ),
      this.db
        .select({
          id: s.connections.id,
          provider: s.connections.provider,
          status: s.connections.status,
        })
        .from(s.connections)
        .where(
          and(
            eq(s.connections.organizationId, scope.organizationId),
            eq(s.connections.ownerId, principal.userId),
          ),
        ),
      this.db
        .select()
        .from(s.mcpGrants)
        .where(
          and(
            eq(s.mcpGrants.organizationId, scope.organizationId),
            eq(s.mcpGrants.userId, principal.userId),
            eq(s.mcpGrants.active, true),
          ),
        ),
      this.db
        .select()
        .from(s.productMemberships)
        .where(
          and(
            eq(s.productMemberships.organizationId, scope.organizationId),
            inArray(s.productMemberships.productId, ids),
          ),
        ),
      this.db.select().from(s.pipelines).where(scoped(s.pipelines)),
      this.db
        .select({
          id: s.touches.id,
          productId: s.touches.productId,
          relationshipId: s.touches.relationshipId,
          senderId: s.touches.senderId,
          status: s.touches.status,
          followUp: s.touches.followUp,
          channel: s.touches.channel,
          dueAt: s.touches.dueAt,
          sentAt: s.touches.sentAt,
          sentBy: s.touches.sentBy,
          enrollmentStatus: s.enrollments.status,
        })
        .from(s.touches)
        .innerJoin(s.enrollments, eq(s.touches.enrollmentId, s.enrollments.id))
        .where(
          and(
            scoped(s.touches),
            or(
              inArray(s.touches.status, ["planned", "approved"]),
              gte(s.touches.sentAt, new Date(Date.now() - 90 * 86400000)),
            ),
          ),
        ),
      this.db
        .select({
          day: messageDay,
          productId: s.messages.productId,
          channel: s.conversations.channel,
          ownerId: s.conversations.ownerId,
          inbound: sql<number>`count(*) FILTER (WHERE ${s.messages.direction}='inbound')::integer`,
          outbound: sql<number>`count(*) FILTER (WHERE ${s.messages.direction}='outbound')::integer`,
        })
        .from(s.messages)
        .innerJoin(
          s.conversations,
          eq(s.messages.conversationId, s.conversations.id),
        )
        .innerJoin(
          s.relationships,
          eq(s.relationships.id, s.conversations.relationshipId),
        )
        .innerJoin(s.people, eq(s.people.id, s.relationships.personId))
        .where(
          and(
            isNull(s.people.archivedAt),
            scoped(s.messages),
            inArray(
              s.messages.conversationId,
              readableConversations.map((c) => c.id),
            ),
            gte(s.messages.occurredAt, new Date(Date.now() - 90 * 86400000)),
            lte(s.messages.occurredAt, new Date()),
          ),
        )
        .groupBy(
          // Group by the selected day: repeating the timezone expression emits
          // a different bind parameter, which PostgreSQL treats as distinct.
          sql`1`,
          s.messages.productId,
          s.conversations.channel,
          s.conversations.ownerId,
        ),
    ]);
    const everyone = await this.db
      .select()
      .from(s.people)
      .where(
        and(
          eq(s.people.organizationId, scope.organizationId),
          inArray(
            s.people.id,
            relationships.map((r) => r.personId),
          ),
        ),
      );
    const people = everyone.filter((person) => !person.archivedAt);
    const activePeople = new Set(people.map((person) => person.id));
    const activeRelationships = relationships.filter((relationship) =>
      activePeople.has(relationship.personId),
    );
    const activeRelationshipIds = new Set(
      activeRelationships.map((relationship) => relationship.id),
    );
    const active = <T extends { relationshipId: string }>(rows: T[]) =>
      rows.filter((row) => activeRelationshipIds.has(row.relationshipId));
    const archivedPeople = everyone.filter((person) => person.archivedAt);
    const companyIds = (rows: typeof everyone) =>
      rows.flatMap((person) => (person.companyId ? [person.companyId] : []));
    const peopleAt = (archived: "active" | "any") =>
      this.db
        .select({ id: s.people.id })
        .from(s.people)
        .where(
          and(
            eq(s.people.companyId, s.companies.id),
            archived === "active" ? isNull(s.people.archivedAt) : undefined,
          ),
        );
    const allCompanies = await this.db
      .select()
      .from(s.companies)
      .where(
        and(
          eq(s.companies.organizationId, scope.organizationId),
          or(
            inArray(s.companies.id, companyIds(people)),
            and(
              notExists(peopleAt("active")),
              or(
                notExists(peopleAt("any")),
                inArray(s.companies.id, companyIds(archivedPeople)),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(s.companies.name));
    const productsOf = (rows: typeof everyone) => [
      ...new Set(
        relationships
          .filter((relationship) =>
            rows.some((person) => person.id === relationship.personId),
          )
          .map((relationship) => relationship.productId),
      ),
    ];
    const companyProducts = (companyId: string) => {
      const current = people.filter((person) => person.companyId === companyId);
      return productsOf(
        current.length
          ? current
          : archivedPeople.filter((person) => person.companyId === companyId),
      );
    };
    return {
      products: permission.products.filter((product) => !product.archivedAt),
      archivedProducts: permission.products.filter(
        (product) => product.archivedAt,
      ),
      people,
      companies: allCompanies.filter((company) => !company.archivedAt),
      archived: {
        people: archivedPeople.map((person) => ({
          id: person.id,
          name: person.name,
          title: person.title,
          companyId: person.companyId,
          archivedAt: person.archivedAt,
          productIds: productsOf([person]),
        })),
        companies: allCompanies
          .filter((company) => company.archivedAt)
          .map((company) => ({
            id: company.id,
            name: company.name,
            domain: company.domain,
            archivedAt: company.archivedAt,
            productIds: companyProducts(company.id),
          })),
      },
      relationships: activeRelationships,
      actions: active(actions),
      sequences,
      enrollments: active(enrollments),
      folders,
      assets,
      assetStages,
      stages: stages.filter((stage) => stage.pipeline === "deal"),
      outreachStages: stages.filter((stage) => stage.pipeline === "outreach"),
      meetings: active(meetings),
      opportunities: active(opportunities),
      pipelines,
      messageStats,
      touchStats: active(touchStats),
      members: members.map((member) => ({
        ...member,
        productIds:
          member.role === "admin"
            ? ids
            : memberProducts
                .filter((p) => p.userId === member.id)
                .map((p) => p.productId),
      })),
      connections,
      grants,
      asOf: new Date().toISOString(),
    };
  }
  async context(
    principal: Principal,
    organizationId: string,
    relationshipId: string,
  ) {
    const [relationship] = await this.db
      .select()
      .from(s.relationships)
      .where(
        and(
          eq(s.relationships.id, relationshipId),
          eq(s.relationships.organizationId, organizationId),
        ),
      );
    if (!relationship) throw new DomainError("NOT_FOUND", 404);
    const permission = await authorize(
      this.db,
      principal,
      organizationId,
      relationship.productId,
    );
    const [person] = await this.db
      .select()
      .from(s.people)
      .where(
        and(
          eq(s.people.id, relationship.personId),
          eq(s.people.organizationId, organizationId),
        ),
      );
    // Legacy read-only assistant grants cannot retrieve archived history.
    // Verified writers need the detail/version to restore a record, as the UI does.
    if (
      principal.source === "mcp" &&
      principal.readOnly !== false &&
      person?.archivedAt
    )
      throw new DomainError("NOT_FOUND", 404);
    const sources = await this.db
      .select()
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.organizationId, organizationId),
          eq(s.conversations.relationshipId, relationshipId),
          or(
            eq(s.conversations.visibility, "product"),
            eq(s.conversations.ownerId, principal.userId),
          ),
        ),
      );
    const [messages, evidence, actions] = await Promise.all([
      this.db
        .select({
          id: s.messages.id,
          direction: s.messages.direction,
          body: s.messages.body,
          occurredAt: s.messages.occurredAt,
          channel: s.conversations.channel,
        })
        .from(s.messages)
        .innerJoin(
          s.conversations,
          eq(s.conversations.id, s.messages.conversationId),
        )
        .where(
          and(
            eq(s.messages.organizationId, organizationId),
            inArray(
              s.messages.conversationId,
              sources.map((source) => source.id),
            ),
          ),
        )
        .orderBy(desc(s.messages.occurredAt))
        .limit(30),
      this.db
        .select()
        .from(s.evidence)
        .where(
          and(
            eq(s.evidence.organizationId, organizationId),
            eq(s.evidence.relationshipId, relationshipId),
          ),
        ),
      this.db
        .select()
        .from(s.actions)
        .where(
          and(
            eq(s.actions.organizationId, organizationId),
            eq(s.actions.relationshipId, relationshipId),
            or(
              isNull(s.actions.sourceConversationId),
              inArray(
                s.actions.sourceConversationId,
                sources.map((source) => source.id),
              ),
            ),
          ),
        ),
    ]);
    const [company] = person?.companyId
      ? await this.db
          .select()
          .from(s.companies)
          .where(
            and(
              eq(s.companies.organizationId, organizationId),
              eq(s.companies.id, person.companyId),
            ),
          )
      : [];
    const [relationships, meetings, opportunities] = await Promise.all([
      this.db
        .select()
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.organizationId, organizationId),
            eq(s.relationships.personId, relationship.personId),
            inArray(
              s.relationships.productId,
              permission.products.map((p) => p.id),
            ),
          ),
        ),
      this.db
        .select()
        .from(s.meetings)
        .where(
          and(
            eq(s.meetings.organizationId, organizationId),
            eq(s.meetings.relationshipId, relationshipId),
          ),
        ),
      this.db
        .select()
        .from(s.opportunities)
        .where(
          and(
            eq(s.opportunities.organizationId, organizationId),
            eq(s.opportunities.relationshipId, relationshipId),
          ),
        ),
    ]);
    return {
      person,
      company: company ?? null,
      relationship,
      relationships,
      products: permission.products,
      meetings,
      opportunities,
      messages,
      evidence,
      actions,
      asOf: new Date().toISOString(),
      coverage: { complete: false, note: "CONTEXT_PARTIAL", pageSize: 30 },
      unknowns: ["BUDGET_UNVERIFIED", "PRIVATE_HISTORY_NOT_ASSERTED"],
    };
  }
  async companyContext(
    principal: Principal,
    scope: z.infer<typeof scopeSchema>,
    companyId: string,
  ) {
    const snapshot = await this.snapshot(principal, scope);
    const readableProducts = [
      ...snapshot.products,
      ...snapshot.archivedProducts,
    ];
    const company =
      snapshot.companies.find((company) => company.id === companyId) ??
      (await this.archivedCompany(
        readableProducts.map((product) => product.id),
        scope.organizationId,
        companyId,
      ));
    if (
      principal.source === "mcp" &&
      principal.readOnly !== false &&
      company.archivedAt
    )
      throw new DomainError("NOT_FOUND", 404);
    const people = snapshot.people.filter(
      (person) => person.companyId === company.id,
    );
    const relationships = snapshot.relationships.filter((relationship) =>
      people.some((person) => person.id === relationship.personId),
    );
    const related = (record: { relationshipId: string }) =>
      relationships.some(
        (relationship) => relationship.id === record.relationshipId,
      );
    return {
      company,
      people,
      relationships,
      products: readableProducts.filter((product) =>
        relationships.some(
          (relationship) => relationship.productId === product.id,
        ),
      ),
      actions: snapshot.actions.filter(related),
      meetings: snapshot.meetings.filter(related),
      opportunities: snapshot.opportunities.filter(related),
      stages: snapshot.stages,
      asOf: snapshot.asOf,
    };
  }
  private async archivedCompany(
    productIds: string[],
    organizationId: string,
    companyId: string,
  ) {
    const [company] = await this.db
      .select()
      .from(s.companies)
      .where(
        and(
          eq(s.companies.id, companyId),
          eq(s.companies.organizationId, organizationId),
        ),
      );
    if (
      !company?.archivedAt ||
      !(await companyVisible(this.db, productIds, organizationId, companyId))
    )
      throw new DomainError("NOT_FOUND", 404);
    return company;
  }
  async personContext(
    principal: Principal,
    organizationId: string,
    personId: string,
  ) {
    const permission = await authorize(this.db, principal, organizationId);
    const [relationship] = await this.db
      .select({ id: s.relationships.id })
      .from(s.relationships)
      .where(
        and(
          eq(s.relationships.organizationId, organizationId),
          eq(s.relationships.personId, personId),
          inArray(
            s.relationships.productId,
            permission.products.map((product) => product.id),
          ),
        ),
      )
      .orderBy(asc(s.relationships.id))
      .limit(1);
    if (!relationship) throw new DomainError("NOT_FOUND", 404);
    return this.context(principal, organizationId, relationship.id);
  }
  async changeAction(
    principal: Principal,
    input: z.infer<typeof actionChangeSchema>,
  ) {
    if (principal.source === "mcp" && principal.readOnly !== false)
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const actionRow = () =>
        tx
          .select()
          .from(s.actions)
          .where(
            and(
              eq(s.actions.id, input.actionId),
              eq(s.actions.organizationId, input.organizationId),
            ),
          );
      const [found] = await actionRow();
      if (!found) throw new DomainError("NOT_FOUND", 404);
      await authorizeAction(tx, principal, found);
      await assertActiveRelationships(tx, input.organizationId, [
        found.relationshipId,
      ]);
      const [action] = await actionRow().for("update");
      if (!action) throw new DomainError("NOT_FOUND", 404);
      if (action.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const [dispatch] = await tx
        .select({ id: s.deliveries.id })
        .from(s.deliveries)
        .where(
          and(
            eq(s.deliveries.actionId, action.id),
            inArray(s.deliveries.status, ["sending", "unknown", "accepted"]),
          ),
        );
      if (dispatch) throw new DomainError("DELIVERY_IN_PROGRESS", 409);
      if (action.status === "completed")
        throw new DomainError("ACTION_COMPLETED", 409);
      if (action.status === "blocked" && input.command !== "rework")
        throw new DomainError("REPLY_BLOCKED", 409);
      const draft = input.draft ?? action.draft;
      const [relationship] = await tx
        .select()
        .from(s.relationships)
        .where(eq(s.relationships.id, action.relationshipId));
      const [person] = await tx
        .select()
        .from(s.people)
        .where(eq(s.people.id, relationship.personId));
      const hash = draftHash({
        draft,
        ...(await draftSubject(tx, person)),
        channel: action.channel,
        productId: action.productId,
      });
      const keepsApproval =
        input.command === "complete" && action.approvedHash === hash;
      if (input.command === "approve" && !draft.trim())
        throw new DomainError("DRAFT_REQUIRED", 400);
      const [result] = await tx
        .update(s.actions)
        .set({
          draft,
          draftHash: hash,
          approvedHash:
            input.command === "approve"
              ? hash
              : keepsApproval
                ? action.approvedHash
                : null,
          approvedBy:
            input.command === "approve"
              ? principal.userId
              : keepsApproval
                ? action.approvedBy
                : null,
          kind: input.command === "rework" ? "reply" : action.kind,
          title: input.command === "rework" ? t.newReplyAction : action.title,
          status: input.command === "complete" ? "completed" : "open",
          version: action.version + 1,
        })
        .where(
          and(
            eq(s.actions.id, action.id),
            eq(s.actions.version, input.version),
          ),
        )
        .returning();
      if (!result) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: action.organizationId,
        productId: action.productId,
        sourceConversationId: action.sourceConversationId,
        actorId: principal.userId,
        type: `action.${input.command}`,
        entityId: action.id,
      });
      return result;
    });
  }
  async planActions(
    principal: Principal,
    input: z.infer<typeof actionPlanSchema>,
  ) {
    if (principal.source === "mcp" && principal.readOnly !== false)
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const items = [...input.items].sort((a, b) =>
        a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0,
      );
      const selectRows = () =>
        tx
          .select()
          .from(s.actions)
          .where(
            and(
              inArray(
                s.actions.id,
                items.map((item) => item.actionId),
              ),
              eq(s.actions.organizationId, input.organizationId),
            ),
          )
          .orderBy(asc(s.actions.id));
      const found = await selectRows();
      if (found.length !== items.length)
        throw new DomainError("NOT_FOUND", 404);
      const products = new Set(found.map((row) => row.productId));
      if (input.productId && [...products].some((id) => id !== input.productId))
        throw new DomainError("FORBIDDEN", 403);
      for (const productId of products)
        await authorize(tx, principal, input.organizationId, productId, true);
      await assertActiveRelationships(
        tx,
        input.organizationId,
        found.map((row) => row.relationshipId),
      );
      const rows = await selectRows().for("update");
      if (rows.length !== items.length) throw new DomainError("NOT_FOUND", 404);
      const sourceIds = [
        ...new Set(
          rows.flatMap((row) =>
            row.sourceConversationId ? [row.sourceConversationId] : [],
          ),
        ),
      ];
      const sources = new Map(
        (sourceIds.length
          ? await tx
              .select()
              .from(s.conversations)
              .where(inArray(s.conversations.id, sourceIds))
          : []
        ).map((source) => [source.id, source]),
      );
      const privateOwner = (action: typeof s.actions.$inferSelect) => {
        const source = sources.get(action.sourceConversationId ?? "");
        return source?.visibility === "private" ? source.ownerId : null;
      };
      const assignees = new Map<string, boolean>();
      const changed: (typeof s.actions.$inferSelect)[] = [];
      for (const item of items) {
        const action = rows.find((row) => row.id === item.actionId);
        if (!action) throw new DomainError("NOT_FOUND", 404);
        const owner = privateOwner(action);
        if (owner && owner !== principal.userId)
          throw new DomainError("FORBIDDEN", 403);
        if (action.version !== item.version)
          throw new DomainError("CONFLICT", 409);
        if (action.status === "blocked" && item.status)
          throw new DomainError("REPLY_BLOCKED", 409);
        if (action.status === "completed" && item.status !== "open")
          throw new DomainError("ACTION_COMPLETED", 409);
        if (item.ownerId) {
          if (owner && owner !== item.ownerId)
            throw new DomainError("ASSIGNEE_PRIVATE_SOURCE", 403);
          const key = `${item.ownerId}:${action.productId}`;
          if (!assignees.has(key)) {
            try {
              await authorize(
                tx,
                { userId: item.ownerId, source: "session" },
                input.organizationId,
                action.productId,
              );
              assignees.set(key, true);
            } catch (error) {
              if (error instanceof DomainError)
                throw new DomainError("OWNER_NOT_ALLOWED", 403);
              throw error;
            }
          }
        }
        const [result] = await tx
          .update(s.actions)
          .set({
            ...(item.status ? { status: item.status } : {}),
            ...(item.dueAt ? { dueAt: new Date(item.dueAt) } : {}),
            ...(item.ownerId ? { ownerId: item.ownerId } : {}),
            // Reopening or replanning is a new intent, not permission to reuse a
            // previously dispatched approval on a later source version.
            approvedHash: null,
            approvedBy: null,
            version: action.version + 1,
          })
          .where(
            and(
              eq(s.actions.id, action.id),
              eq(s.actions.version, item.version),
            ),
          )
          .returning();
        if (!result) throw new DomainError("CONFLICT", 409);
        const types = [
          item.status === "completed" ? "action.complete" : "",
          item.status === "open" && action.status === "completed"
            ? "action.reopen"
            : "",
          item.dueAt ? "action.snooze" : "",
          item.ownerId ? "action.assign" : "",
        ].filter(Boolean);
        if (types.length)
          await tx.insert(s.changeEvents).values(
            types.map((type) => ({
              organizationId: action.organizationId,
              productId: action.productId,
              sourceConversationId: action.sourceConversationId,
              actorId: principal.userId,
              type,
              entityId: action.id,
            })),
          );
        changed.push(result);
      }
      return changed;
    });
  }
  async createFolder(
    principal: Principal,
    input: z.infer<typeof folderSchema>,
  ) {
    await authorize(
      this.db,
      principal,
      input.organizationId,
      input.productId,
      true,
    );
    return this.db.transaction(async (tx) => {
      await assertProductActive(tx, input.organizationId, input.productId);
      if (input.parentId) {
        const [parent] = await tx
          .select()
          .from(s.folders)
          .where(
            and(
              eq(s.folders.id, input.parentId),
              eq(s.folders.organizationId, input.organizationId),
              eq(s.folders.productId, input.productId),
            ),
          );
        if (!parent) throw new DomainError("NOT_FOUND", 404);
      }
      const [folder] = await tx
        .insert(s.folders)
        .values({ ...input, parentId: input.parentId ?? null })
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: "folder.created",
        entityId: folder.id,
      });
      return folder;
    });
  }
  async acceptCommitment(
    principal: Principal,
    input: z.infer<typeof meetingChangeSchema>,
  ) {
    if (principal.source === "mcp" && principal.readOnly !== false)
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const [meeting] = await tx
        .select()
        .from(s.meetings)
        .where(
          and(
            eq(s.meetings.id, input.meetingId),
            eq(s.meetings.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (!meeting) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        meeting.productId,
        true,
      );
      if (meeting.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      await assertActiveRelationships(tx, input.organizationId, [
        meeting.relationshipId,
      ]);
      if (meeting.commitmentActionId)
        return { actionId: meeting.commitmentActionId };
      if (meeting.status !== "held" || !meeting.proposedCommitment)
        throw new DomainError("NO_COMMITMENT", 409);
      await assertProductActive(tx, input.organizationId, meeting.productId);
      try {
        await authorize(
          tx,
          { userId: input.ownerId, source: "session" },
          input.organizationId,
          meeting.productId,
        );
      } catch (error) {
        if (error instanceof DomainError)
          throw new DomainError("OWNER_NOT_ALLOWED", 403);
        throw error;
      }
      const [action] = await tx
        .insert(s.actions)
        .values({
          organizationId: input.organizationId,
          productId: meeting.productId,
          relationshipId: meeting.relationshipId,
          ownerId: input.ownerId,
          kind: "commitment",
          title: meeting.proposedCommitment,
          reason: meeting.title,
          owedBy: "us",
          channel: "gmail",
          dueAt: new Date(input.dueAt),
        })
        .returning();
      await tx
        .update(s.meetings)
        .set({ commitmentActionId: action.id, version: meeting.version + 1 })
        .where(eq(s.meetings.id, meeting.id));
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: meeting.productId,
        actorId: principal.userId,
        type: "commitment.accepted",
        entityId: action.id,
      });
      return { actionId: action.id };
    });
  }
  async revision(principal: Principal, organizationId: string) {
    const permission = await authorize(this.db, principal, organizationId);
    const readable = this.db
      .select({ id: s.conversations.id })
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.organizationId, organizationId),
          inArray(
            s.conversations.productId,
            permission.products.map((p) => p.id),
          ),
          or(
            eq(s.conversations.visibility, "product"),
            eq(s.conversations.ownerId, principal.userId),
          ),
        ),
      );
    const [result] = await this.db
      .select({ revision: sql<string>`count(*)::text` })
      .from(s.changeEvents)
      .where(
        and(
          eq(s.changeEvents.organizationId, organizationId),
          or(
            isNull(s.changeEvents.sourceConversationId),
            inArray(s.changeEvents.sourceConversationId, readable),
          ),
          or(
            isNull(s.changeEvents.productId),
            inArray(
              s.changeEvents.productId,
              permission.products.map((p) => p.id),
            ),
          ),
        ),
      );
    return result?.revision ?? "0";
  }
  private async authorizeOrganizationCreation(principal: Principal) {
    if (principal.readOnly) throw new DomainError("FORBIDDEN", 403);
    if (principal.source !== "mcp") return;
    if (
      principal.readOnly !== false ||
      !principal.organizationId ||
      principal.productIds !== undefined
    )
      throw new DomainError("FORBIDDEN", 403);
    const { membership } = await authorize(
      this.db,
      principal,
      principal.organizationId,
      undefined,
      true,
    );
    if (membership.role !== "admin") throw new DomainError("FORBIDDEN", 403);
  }
  async createWorkspace(
    principal: Principal,
    input: z.infer<typeof workspaceSchema>,
  ) {
    await this.authorizeOrganizationCreation(principal);
    const values = workspaceSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(s.organizations)
        .values({
          name: values.name,
          timezone: values.timezone,
          slug: `${values.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 40)}-${randomUUID().slice(0, 8)}`,
        })
        .returning();
      await tx.insert(s.memberships).values({
        organizationId: organization.id,
        userId: principal.userId,
        role: "admin",
      });
      const product = await insertProduct(
        tx,
        organization.id,
        values.productName,
        principal.userId,
      );
      return { organizationId: organization.id, productId: product.id };
    });
  }
  async createOrganization(
    principal: Principal,
    name: string,
    timezone = "UTC",
  ) {
    await this.authorizeOrganizationCreation(principal);
    return this.db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(s.organizations)
        .values({
          name,
          timezone,
          slug: `${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 40)}-${randomUUID().slice(0, 8)}`,
        })
        .returning();
      await tx.insert(s.memberships).values({
        organizationId: organization.id,
        userId: principal.userId,
        role: "admin",
      });
      return organization;
    });
  }
  async overview(
    principal: Principal,
    input: z.infer<typeof scopeSchema> & {
      days: number;
      ownerId?: string;
      channel?: string;
    },
  ) {
    const snapshot = await this.snapshot(principal, input);
    const [organization] = await this.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, input.organizationId));
    return {
      ...calculateOverview(serialize(snapshot), {
        days: input.days,
        ownerId: input.ownerId,
        channel: input.channel,
        timeZone: organization.timezone,
      }),
      asOf: snapshot.asOf,
      timeZone: organization.timezone,
    };
  }
  async saveOpportunity(
    principal: Principal,
    input: z.infer<typeof opportunitySchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      if (!input.id)
        await assertProductActive(tx, input.organizationId, input.productId);
      const [relationship] = await tx
        .select()
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.id, input.relationshipId),
            eq(s.relationships.organizationId, input.organizationId),
            eq(s.relationships.productId, input.productId),
          ),
        );
      const [stage] = await tx
        .select()
        .from(s.stages)
        .where(
          and(
            eq(s.stages.id, input.stageId),
            eq(s.stages.pipeline, "deal"),
            isNull(s.stages.archivedAt),
            eq(s.stages.organizationId, input.organizationId),
            eq(s.stages.productId, input.productId),
          ),
        )
        .for("share");
      if (!relationship || !stage) throw new DomainError("FORBIDDEN", 403);
      await assertActiveRelationships(tx, input.organizationId, [
        relationship.id,
      ]);
      if (stage.category !== input.status)
        throw new DomainError("DEAL_STAGE_OUTCOME", 400);
      try {
        await authorize(
          tx,
          { userId: input.ownerId, source: "session" },
          input.organizationId,
          input.productId,
        );
      } catch {
        throw new DomainError("OWNER_NOT_ALLOWED", 403);
      }
      const [existing] = input.id
        ? await tx
            .select()
            .from(s.opportunities)
            .where(
              and(
                eq(s.opportunities.id, input.id),
                eq(s.opportunities.organizationId, input.organizationId),
              ),
            )
            .for("update")
        : [];
      if (input.id && !existing) throw new DomainError("NOT_FOUND", 404);
      if (
        existing &&
        (existing.productId !== input.productId ||
          existing.relationshipId !== input.relationshipId)
      )
        throw new DomainError("FORBIDDEN", 403);
      if (existing && existing.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const { id, version: _version, ...values } = input;
      const now = new Date();
      const fields = {
        ...values,
        probability:
          input.status === "won"
            ? 100
            : input.status === "lost"
              ? 0
              : input.probability,
        closedAt:
          input.status === "open"
            ? null
            : existing?.status === input.status
              ? existing.closedAt
              : now,
        updatedAt: now,
      };
      const [deal] = existing
        ? await tx
            .update(s.opportunities)
            .set({ ...fields, version: existing.version + 1 })
            .where(eq(s.opportunities.id, existing.id))
            .returning()
        : await tx
            .insert(s.opportunities)
            .values({ ...fields, createdAt: now })
            .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: existing ? "opportunity.updated" : "opportunity.created",
        entityId: deal.id,
      });
      return deal;
    });
  }
  async createPipeline(
    principal: Principal,
    input: z.infer<typeof pipelineSchema>,
  ) {
    const { membership } = await authorize(
      this.db,
      principal,
      input.organizationId,
      input.productId,
      true,
    );
    if (membership.role !== "admin") throw new DomainError("FORBIDDEN", 403);
    return this.db.transaction(async (tx) => {
      await assertProductActive(tx, input.organizationId, input.productId);
      const [pipeline] = await tx
        .insert(s.pipelines)
        .values(input)
        .onConflictDoNothing()
        .returning();
      if (!pipeline) throw new DomainError("PIPELINE_EXISTS", 409);
      await tx.insert(s.stages).values(
        [t.discovery, t.evaluation, t.proposal, t.won, t.lost].map(
          (name, position) => ({
            organizationId: input.organizationId,
            productId: input.productId,
            pipelineId: pipeline.id,
            name,
            position,
            category:
              position === 3
                ? ("won" as const)
                : position === 4
                  ? ("lost" as const)
                  : ("open" as const),
          }),
        ),
      );
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: "pipeline.created",
        entityId: pipeline.id,
      });
      return pipeline;
    });
  }
  async messageActivity(
    principal: Principal,
    input: z.infer<typeof messageActivitySchema>,
  ) {
    const permission = await authorize(
      this.db,
      principal,
      input.organizationId,
      input.productId,
    );
    const ids = permission.products
      .filter((p) => !input.productId || p.id === input.productId)
      .map((p) => p.id);
    const [organization] = await this.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, input.organizationId));
    const rows = await this.db
      .select({
        id: s.messages.id,
        productId: s.messages.productId,
        relationshipId: s.conversations.relationshipId,
        ownerId: s.conversations.ownerId,
        channel: s.conversations.channel,
        direction: s.messages.direction,
        occurredAt: s.messages.occurredAt,
        preview: sql<string>`left(${s.messages.body},200)`,
      })
      .from(s.messages)
      .innerJoin(
        s.conversations,
        eq(s.messages.conversationId, s.conversations.id),
      )
      .innerJoin(
        s.relationships,
        eq(s.relationships.id, s.conversations.relationshipId),
      )
      .innerJoin(s.people, eq(s.people.id, s.relationships.personId))
      .where(
        and(
          isNull(s.people.archivedAt),
          lte(s.messages.occurredAt, new Date()),
          eq(s.messages.organizationId, input.organizationId),
          inArray(s.messages.productId, ids),
          or(
            eq(s.conversations.visibility, "product"),
            eq(s.conversations.ownerId, principal.userId),
          ),
          sql`${s.messages.occurredAt} >= (${input.from}::date::timestamp AT TIME ZONE ${organization.timezone})`,
          sql`${s.messages.occurredAt} < ((${input.through}::date + 1)::timestamp AT TIME ZONE ${organization.timezone})`,
          input.ownerId
            ? eq(s.conversations.ownerId, input.ownerId)
            : undefined,
          input.direction
            ? eq(s.messages.direction, input.direction)
            : undefined,
          input.channel
            ? eq(s.conversations.channel, input.channel)
            : undefined,
        ),
      )
      .orderBy(desc(s.messages.occurredAt), desc(s.messages.id))
      .limit(51)
      .offset(input.page * 50);
    return {
      items: rows.slice(0, 50),
      hasMore: rows.length > 50,
      page: input.page,
    };
  }
  async createProduct(
    principal: Principal,
    organizationId: string,
    name: string,
  ) {
    const { membership } = await authorize(
      this.db,
      principal,
      organizationId,
      undefined,
      true,
    );
    if (
      membership.role !== "admin" ||
      (principal.source === "mcp" && principal.productIds !== undefined)
    )
      throw new DomainError("FORBIDDEN", 403);
    return this.db.transaction((tx) =>
      insertProduct(tx, organizationId, name, principal.userId),
    );
  }
}
export type Snapshot = Awaited<ReturnType<CrmService["snapshot"]>>;
export type PersonContext = Awaited<ReturnType<CrmService["context"]>>;

export type CompanyContext = Awaited<ReturnType<CrmService["companyContext"]>>;

async function authorizeAction(
  db: Database,
  principal: Principal,
  action: typeof s.actions.$inferSelect,
) {
  await authorize(db, principal, action.organizationId, action.productId, true);
  if (!action.sourceConversationId) return;
  const [source] = await db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, action.sourceConversationId));
  if (source.visibility === "private" && source.ownerId !== principal.userId)
    throw new DomainError("FORBIDDEN", 403);
}
