import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import t from "../i18n/translations/en.json";
import { authorize, DomainError, type Principal } from "./policy";

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
      if (personId || input.companyId) {
        const [visible] = await tx
          .select({ personId: s.people.id })
          .from(s.people)
          .innerJoin(s.relationships, eq(s.relationships.personId, s.people.id))
          .where(
            and(
              eq(s.people.organizationId, input.organizationId),
              inArray(
                s.relationships.productId,
                permission.products.map((p) => p.id),
              ),
              personId
                ? eq(s.people.id, personId)
                : eq(s.people.companyId, input.companyId ?? ""),
            ),
          );
        if (!visible) throw new DomainError("NOT_FOUND", 404);
      }
      if (!personId) {
        if (input.email) {
          const [existing] = await tx
            .select({ id: s.people.id })
            .from(s.people)
            .where(
              and(
                eq(s.people.organizationId, input.organizationId),
                sql`lower(${s.people.email}) = ${input.email.toLowerCase()}`,
              ),
            );
          if (existing) throw new DomainError("PERSON_EXISTS", 409);
        }
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
        .orderBy(asc(s.actions.dueAt)),
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
        .orderBy(asc(s.stages.position)),
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
    const people = await this.db
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
    const companies = await this.db
      .select()
      .from(s.companies)
      .where(
        and(
          eq(s.companies.organizationId, scope.organizationId),
          inArray(
            s.companies.id,
            people.flatMap((p) => (p.companyId ? [p.companyId] : [])),
          ),
        ),
      );
    return {
      products: permission.products,
      people,
      companies,
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
    const company = snapshot.companies.find(
      (company) => company.id === companyId,
    );
    if (!company) throw new DomainError("NOT_FOUND", 404);
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
      await authorize(
        tx,
        principal,
        input.organizationId,
        action.productId,
        true,
      );
      if (action.sourceConversationId) {
        const [source] = await tx
          .select()
          .from(s.conversations)
          .where(eq(s.conversations.id, action.sourceConversationId));
        if (
          source.visibility === "private" &&
          source.ownerId !== principal.userId
        )
          throw new DomainError("FORBIDDEN", 403);
      }
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
      if (input.command === "approve" && !draft.trim())
        throw new DomainError("DRAFT_REQUIRED", 400);
      const [result] = await tx
        .update(s.actions)
        .set({
          draft,
          draftHash: hash,
          approvedHash: input.command === "approve" ? hash : null,
          approvedBy: input.command === "approve" ? principal.userId : null,
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
          inArray(
            s.changeEvents.productId,
            permission.products.map((p) => p.id),
          ),
        ),
      );
    return result?.revision ?? "0";
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
    return this.db.transaction(async (tx) => {
      const [product] = await tx
        .insert(s.products)
        .values({ organizationId, name })
        .onConflictDoNothing({
          target: [s.products.organizationId, s.products.name],
        })
        .returning();
      if (!product) throw new DomainError("PRODUCT_EXISTS", 409);
      await tx.insert(s.folders).values({
        organizationId,
        productId: product.id,
        name: t.defaultFolder,
      });
      await tx.insert(s.stages).values(
        [t.discovery, t.evaluation, t.proposal, t.won].map(
          (name, position) => ({
            organizationId,
            productId: product.id,
            name,
            position,
          }),
        ),
      );
      await tx.insert(s.changeEvents).values({
        organizationId,
        productId: product.id,
        actorId: principal.userId,
        type: "product.created",
        entityId: product.id,
      });
      return product;
    });
  }
}
export type Snapshot = Awaited<ReturnType<CrmService["snapshot"]>>;
export type PersonContext = Awaited<ReturnType<CrmService["context"]>>;

export type CompanyContext = Awaited<ReturnType<CrmService["companyContext"]>>;
