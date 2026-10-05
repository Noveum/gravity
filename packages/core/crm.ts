import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import t from "../i18n/translations/en.json";
import { authorize, DomainError, type Principal } from "./policy";
import {
  activeCompany,
  assertActiveRelationships,
  companyVisible,
  emailTaken,
  personVisible,
} from "./visibility";

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
export const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  productName: z.string().trim().min(1).max(100),
  timezone: z
    .string()
    .max(100)
    .default("UTC")
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
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
  await tx.insert(s.stages).values(defaultStages(organizationId, product.id));
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
    if (principal.source === "mcp")
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
            eq(s.enrollments.status, "paused_reply"),
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
    if (principal.source === "mcp")
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
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
      const [relationship] = await tx
        .insert(s.relationships)
        .values({
          organizationId: input.organizationId,
          productId: input.productId,
          personId,
          ownerId: principal.userId,
          purpose: input.purpose,
          context: input.context,
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
      })
      .from(s.organizations)
      .innerJoin(
        s.memberships,
        and(
          eq(s.organizations.id, s.memberships.organizationId),
          eq(s.memberships.userId, principal.userId),
          eq(s.memberships.active, true),
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
        .orderBy(asc(s.stages.position), asc(s.stages.id)),
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
      products: permission.products,
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
      stages,
      meetings: active(meetings),
      opportunities: active(opportunities),
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
    const company =
      snapshot.companies.find((company) => company.id === companyId) ??
      (await this.archivedCompany(
        snapshot.products.map((product) => product.id),
        scope.organizationId,
        companyId,
      ));
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
      products: snapshot.products.filter((product) =>
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
    if (principal.source === "mcp")
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const [action] = await tx
        .select()
        .from(s.actions)
        .where(
          and(
            eq(s.actions.id, input.actionId),
            eq(s.actions.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (!action) throw new DomainError("NOT_FOUND", 404);
      await authorizeAction(tx, principal, action);
      await assertActiveRelationships(tx, input.organizationId, [
        action.relationshipId,
      ]);
      if (action.version !== input.version)
        throw new DomainError("CONFLICT", 409);
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
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            draft,
            personId: person.id,
            email: person.email,
            channel: action.channel,
            productId: action.productId,
          }),
        )
        .digest("hex");
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
    if (principal.source === "mcp")
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const items = [...input.items].sort((a, b) =>
        a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0,
      );
      const rows = await tx
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
        .orderBy(asc(s.actions.id))
        .for("update");
      if (rows.length !== items.length) throw new DomainError("NOT_FOUND", 404);
      const products = new Set(rows.map((row) => row.productId));
      await assertActiveRelationships(
        tx,
        input.organizationId,
        rows.map((row) => row.relationshipId),
      );
      if (input.productId && [...products].some((id) => id !== input.productId))
        throw new DomainError("FORBIDDEN", 403);
      for (const productId of products)
        await authorize(tx, principal, input.organizationId, productId, true);
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
    if (input.parentId) {
      const [parent] = await this.db
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
    return this.db.transaction(async (tx) => {
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
    if (principal.source === "mcp")
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
  async createWorkspace(
    principal: Principal,
    input: z.infer<typeof workspaceSchema>,
  ) {
    if (principal.source === "mcp" || principal.readOnly)
      throw new DomainError("FORBIDDEN", 403);
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
  async createOrganization(principal: Principal, name: string) {
    if (principal.source === "mcp") throw new DomainError("FORBIDDEN", 403);
    return this.db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(s.organizations)
        .values({
          name,
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
    if (membership.role !== "admin" || principal.source === "mcp")
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
