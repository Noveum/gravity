import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { publishChange } from "./changes";
import { recordContactSubmission } from "./contact-attribution";
import { lockContactDirectory } from "./contact-history";
import { scopeSchema } from "./crm";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import { tagsSchema } from "./record-tags";
import {
  activeCompany,
  assertActiveRelationships,
  clearApprovals,
  companyVisible,
  emailTaken,
  linkedinKey,
  linkedinTaken,
  lockOrganization,
  personVisible,
  shareLockStage,
} from "./visibility";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const version = z.number().int().positive();
const emailAddress = z.string().trim().toLowerCase().pipe(z.email().max(254));
const hostname =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const companyDomain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) =>
    value
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/?#].*$/, ""),
  )
  .refine((value) => value === "" || hostname.test(value));
export const linkedinUrl = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        (url.hostname === "linkedin.com" ||
          url.hostname.endsWith(".linkedin.com")) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });

export const personUpdateSchema = scopeSchema.extend({
  personId: z.uuid(),
  version,
  name: z.string().trim().min(1).max(100),
  title: z.string().trim().max(150).default(""),
  email: emailAddress.nullable().default(null),
  otherEmails: z.array(emailAddress).max(10).default([]),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+\d\s().-]*$/)
    .default(""),
  linkedinUrl: linkedinUrl.default(""),
  companyId: z.uuid().nullable().optional(),
  summary: z.string().trim().max(10000).optional(),
});
export const personArchiveSchema = scopeSchema.extend({
  personId: z.uuid(),
  version,
  archived: z.boolean(),
});
export const companySchema = scopeSchema
  .extend({
    companyId: z.uuid().optional(),
    version: version.optional(),
    name: z.string().trim().min(1).max(100),
    domain: companyDomain.default(""),
    description: z.string().trim().max(2000).default(""),
  })
  .refine((value) => !value.companyId === !value.version);
export const companyArchiveSchema = scopeSchema.extend({
  companyId: z.uuid(),
  version,
  archived: z.boolean(),
});
export const meetingSchema = scopeSchema
  .extend({
    meetingId: z.uuid().optional(),
    version: version.optional(),
    relationshipId: z.uuid().optional(),
    title: z.string().trim().min(1).max(200),
    startsAt: z.iso.datetime(),
    status: z.enum(["scheduled", "held", "canceled"]),
    summary: z.string().trim().max(10000).default(""),
  })
  .refine((value) =>
    value.meetingId
      ? value.version !== undefined && value.relationshipId === undefined
      : value.version === undefined && value.relationshipId !== undefined,
  );
const amountMinor = z.number().int().min(0).max(2147483647).nullable();
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
export const opportunityCreateSchema = scopeSchema.extend({
  relationshipId: z.uuid(),
  stageId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  amountMinor: amountMinor.default(null),
  currency: currency.default("USD"),
});
export const opportunityRemovalSchema = scopeSchema.extend({
  opportunityId: z.uuid(),
  version,
});
export const opportunityRestoreSchema = opportunityRemovalSchema.extend({
  stageId: z.uuid().optional(),
});
export const opportunityArchiveSchema = opportunityRestoreSchema.extend({
  archived: z.boolean(),
});
export const opportunityChangeSchema = scopeSchema
  .extend({
    opportunityId: z.uuid(),
    version,
    name: z.string().trim().min(1).max(200).optional(),
    stageId: z.uuid().optional(),
    amountMinor: amountMinor.optional(),
    currency: currency.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.stageId !== undefined ||
      value.amountMinor !== undefined ||
      value.currency !== undefined,
  );

export const mergeRecordsSchema = scopeSchema.extend({
  entity: z.enum(["person", "company"]),
  targetId: z.uuid(),
  targetVersion: version,
  sourceId: z.uuid(),
  sourceVersion: version,
  name: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().max(150).optional(),
  email: emailAddress.nullable().optional(),
  otherEmails: z.array(emailAddress).max(10).optional(),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+\d\s().-]*$/)
    .optional(),
  linkedinUrl: linkedinUrl.optional(),
  companyId: z.uuid().nullable().optional(),
  summary: z.string().trim().max(10000).optional(),
  doNotContact: z.boolean().optional(),
  timeZone: z.string().nullable().optional(),
  domain: companyDomain.optional(),
  description: z.string().trim().max(2000).optional(),
  tags: tagsSchema.optional(),
  amountMinor: amountMinor.optional(),
  currency: currency.optional(),
});

function requireWriteActor(principal: Principal) {
  if (principal.source === "mcp" && principal.readOnly !== false)
    throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
}

async function writableRelationship(
  tx: Transaction,
  principal: Principal,
  organizationId: string,
  relationshipId: string,
  productId: string | undefined,
) {
  const [relationship] = await tx
    .select({
      id: s.relationships.id,
      productId: s.relationships.productId,
      ownerId: s.relationships.ownerId,
    })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.id, relationshipId),
        eq(s.relationships.organizationId, organizationId),
      ),
    );
  if (!relationship) throw new DomainError("NOT_FOUND", 404);
  await authorize(tx, principal, organizationId, relationship.productId, true);
  if (productId && productId !== relationship.productId)
    throw new DomainError("FORBIDDEN", 403);
  await assertActiveRelationships(tx, organizationId, [relationship.id]);
  return relationship;
}

async function stageFor(
  tx: Transaction,
  organizationId: string,
  productId: string,
  stageId: string,
) {
  const [stage] = await tx
    .select()
    .from(s.stages)
    .where(
      and(
        eq(s.stages.id, stageId),
        eq(s.stages.organizationId, organizationId),
        eq(s.stages.productId, productId),
        eq(s.stages.pipeline, "deal"),
        isNull(s.stages.archivedAt),
      ),
    )
    .for("share");
  if (!stage) throw new DomainError("NOT_FOUND", 404);
  return stage;
}

const stageEvent = (category: "open" | "won" | "lost" | "hold") =>
  category === "won"
    ? "opportunity.won"
    : category === "lost"
      ? "opportunity.lost"
      : "opportunity.moved";

export class RecordService {
  constructor(private db: Database) {}

  async updatePerson(
    principal: Principal,
    input: z.infer<typeof personUpdateSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await lockOrganization(tx, input.organizationId);
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      const productIds = permission.products.map((product) => product.id);
      const [person] = await tx
        .select()
        .from(s.people)
        .where(
          and(
            eq(s.people.id, input.personId),
            eq(s.people.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (
        !person ||
        !(await personVisible(tx, productIds, input.organizationId, person.id))
      )
        throw new DomainError("NOT_FOUND", 404);
      if (person.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      if (person.archivedAt) throw new DomainError("RECORD_ARCHIVED", 409);
      if (
        await emailTaken(
          tx,
          input.organizationId,
          [...(input.email ? [input.email] : []), ...input.otherEmails],
          person.id,
        )
      )
        throw new DomainError("PERSON_EXISTS", 409);
      if (
        input.linkedinUrl !== person.linkedinUrl &&
        (await linkedinTaken(
          tx,
          input.organizationId,
          input.linkedinUrl,
          person.id,
        ))
      )
        throw new DomainError("PERSON_EXISTS", 409);
      if (input.companyId && input.companyId !== person.companyId)
        await activeCompany(
          tx,
          productIds,
          input.organizationId,
          input.companyId,
        );
      const otherEmails = [...new Set(input.otherEmails)].filter(
        (email) => email !== input.email,
      );
      const reachChanged =
        (input.email ?? null) !== (person.email ?? null) ||
        input.linkedinUrl !== person.linkedinUrl ||
        [...otherEmails].sort().join(" ") !==
          [...person.otherEmails].sort().join(" ");
      if (principal.source === "mcp" && person.doNotContact && reachChanged)
        throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
      const [updated] = await tx
        .update(s.people)
        .set({
          name: input.name,
          title: input.title,
          email: input.email,
          otherEmails,
          phone: input.phone,
          linkedinUrl: input.linkedinUrl,
          ...(input.companyId !== undefined
            ? { companyId: input.companyId }
            : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          version: person.version + 1,
        })
        .where(
          and(eq(s.people.id, person.id), eq(s.people.version, input.version)),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await recordContactSubmission(tx, principal, {
        organizationId: input.organizationId,
        personId: person.id,
        kind: "updated",
      });
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "person.updated",
        entityId: person.id,
      });
      if (
        (person.email ?? null) !== (updated.email ?? null) ||
        person.name !== updated.name ||
        person.title !== updated.title ||
        (person.companyId ?? null) !== (updated.companyId ?? null)
      )
        await clearApprovals(tx, principal, input.organizationId, person.id);
      return updated;
    });
  }

  async archivePerson(
    principal: Principal,
    input: z.infer<typeof personArchiveSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      const [person] = await tx
        .select()
        .from(s.people)
        .where(
          and(
            eq(s.people.id, input.personId),
            eq(s.people.organizationId, input.organizationId),
          ),
        )
        .for("update");
      const writable = new Set(
        permission.products.map((product) => product.id),
      );
      if (
        !person ||
        !(await personVisible(
          tx,
          [...writable],
          input.organizationId,
          person.id,
        ))
      )
        throw new DomainError("NOT_FOUND", 404);
      if (person.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const relationships = await tx
        .select({
          id: s.relationships.id,
          productId: s.relationships.productId,
        })
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.organizationId, input.organizationId),
            eq(s.relationships.personId, person.id),
          ),
        );
      const blocked = new Set(
        relationships
          .map((relationship) => relationship.productId)
          .filter((productId) => !writable.has(productId)),
      );
      if (blocked.size)
        throw new DomainError("ARCHIVE_NEEDS_EVERY_BRAND", 403, {
          count: blocked.size,
        });
      if (input.archived && !person.archivedAt) {
        await clearApprovals(tx, principal, input.organizationId, person.id);
        const paused = relationships.length
          ? await tx
              .update(s.enrollments)
              .set({
                status: "paused",
                pauseReason: "archived",
                version: sql`${s.enrollments.version} + 1`,
              })
              .where(
                and(
                  eq(s.enrollments.organizationId, input.organizationId),
                  inArray(
                    s.enrollments.relationshipId,
                    relationships.map((relationship) => relationship.id),
                  ),
                  eq(s.enrollments.status, "running"),
                ),
              )
              .returning()
          : [];
        if (paused.length)
          await tx.insert(s.changeEvents).values(
            paused.map((enrollment) => ({
              organizationId: enrollment.organizationId,
              productId: enrollment.productId,
              actorId: principal.userId,
              type: "enrollment.paused",
              entityId: enrollment.id,
            })),
          );
      }
      const [updated] = await tx
        .update(s.people)
        .set({
          archivedAt: input.archived ? (person.archivedAt ?? new Date()) : null,
          version: person.version + 1,
        })
        .where(
          and(eq(s.people.id, person.id), eq(s.people.version, input.version)),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await recordContactSubmission(tx, principal, {
        organizationId: input.organizationId,
        personId: person.id,
        kind: "updated",
      });
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: input.archived ? "person.archived" : "person.restored",
        entityId: person.id,
      });
      return updated;
    });
  }

  async saveCompany(
    principal: Principal,
    input: z.infer<typeof companySchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      const productIds = permission.products.map((product) => product.id);
      const domain = input.domain || null;
      await lockOrganization(tx, input.organizationId);
      let existing: typeof s.companies.$inferSelect | undefined;
      if (input.companyId) {
        [existing] = await tx
          .select()
          .from(s.companies)
          .where(
            and(
              eq(s.companies.id, input.companyId),
              eq(s.companies.organizationId, input.organizationId),
            ),
          )
          .for("update");
        if (
          !existing ||
          !(await companyVisible(
            tx,
            productIds,
            input.organizationId,
            existing.id,
          ))
        )
          throw new DomainError("NOT_FOUND", 404);
        if (existing.version !== input.version)
          throw new DomainError("CONFLICT", 409);
        if (existing.archivedAt) throw new DomainError("RECORD_ARCHIVED", 409);
      }
      if (domain) {
        const duplicates = await tx
          .select({ id: s.companies.id })
          .from(s.companies)
          .where(
            and(
              eq(s.companies.organizationId, input.organizationId),
              eq(s.companies.domain, domain),
              isNull(s.companies.archivedAt),
              ...(existing ? [ne(s.companies.id, existing.id)] : []),
            ),
          );
        for (const duplicate of duplicates)
          if (
            await companyVisible(
              tx,
              productIds,
              input.organizationId,
              duplicate.id,
            )
          )
            throw new DomainError("COMPANY_EXISTS", 409);
      }
      const values = {
        name: input.name,
        domain,
        description: input.description,
      };
      const [saved] = existing
        ? await tx
            .update(s.companies)
            .set({ ...values, version: existing.version + 1 })
            .where(
              and(
                eq(s.companies.id, existing.id),
                eq(s.companies.version, existing.version),
              ),
            )
            .returning()
        : await tx
            .insert(s.companies)
            .values({ ...values, organizationId: input.organizationId })
            .returning();
      if (!saved) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: existing ? "company.updated" : "company.created",
        entityId: saved.id,
      });
      if (existing && existing.name !== saved.name) {
        const employees = await tx
          .select({ id: s.people.id })
          .from(s.people)
          .where(
            and(
              eq(s.people.organizationId, input.organizationId),
              eq(s.people.companyId, saved.id),
            ),
          );
        for (const employee of employees)
          await clearApprovals(
            tx,
            principal,
            input.organizationId,
            employee.id,
          );
      }
      return saved;
    });
  }

  async archiveCompany(
    principal: Principal,
    input: z.infer<typeof companyArchiveSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      const [company] = await tx
        .select()
        .from(s.companies)
        .where(
          and(
            eq(s.companies.id, input.companyId),
            eq(s.companies.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (
        !company ||
        !(await companyVisible(
          tx,
          permission.products.map((product) => product.id),
          input.organizationId,
          company.id,
        ))
      )
        throw new DomainError("NOT_FOUND", 404);
      if (company.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      if (!input.archived && company.domain) {
        const [duplicate] = await tx
          .select({ id: s.companies.id })
          .from(s.companies)
          .where(
            and(
              eq(s.companies.organizationId, input.organizationId),
              eq(s.companies.domain, company.domain),
              isNull(s.companies.archivedAt),
              ne(s.companies.id, company.id),
            ),
          );
        if (duplicate) throw new DomainError("COMPANY_EXISTS", 409);
      }
      const [updated] = await tx
        .update(s.companies)
        .set({
          archivedAt: input.archived ? new Date() : null,
          version: company.version + 1,
        })
        .where(
          and(
            eq(s.companies.id, company.id),
            eq(s.companies.version, input.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: input.archived ? "company.archived" : "company.restored",
        entityId: company.id,
      });
      return updated;
    });
  }

  async saveMeeting(
    principal: Principal,
    input: z.infer<typeof meetingSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      const values = {
        title: input.title,
        startsAt: new Date(input.startsAt),
        status: input.status,
        summary: input.summary,
      };
      if (!input.meetingId) {
        const relationship = await writableRelationship(
          tx,
          principal,
          input.organizationId,
          input.relationshipId ?? "",
          input.productId,
        );
        await assertProductActive(
          tx,
          input.organizationId,
          relationship.productId,
        );
        const [meeting] = await tx
          .insert(s.meetings)
          .values({
            ...values,
            organizationId: input.organizationId,
            productId: relationship.productId,
            relationshipId: relationship.id,
          })
          .returning();
        await tx.insert(s.changeEvents).values({
          organizationId: input.organizationId,
          productId: relationship.productId,
          actorId: principal.userId,
          type: "meeting.created",
          entityId: meeting.id,
        });
        return meeting;
      }
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
      if (input.productId && input.productId !== meeting.productId)
        throw new DomainError("FORBIDDEN", 403);
      if (meeting.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      await assertActiveRelationships(tx, input.organizationId, [
        meeting.relationshipId,
      ]);
      const [updated] = await tx
        .update(s.meetings)
        .set({ ...values, version: meeting.version + 1 })
        .where(
          and(
            eq(s.meetings.id, meeting.id),
            eq(s.meetings.version, meeting.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: meeting.productId,
        actorId: principal.userId,
        type: "meeting.updated",
        entityId: meeting.id,
      });
      return updated;
    });
  }

  async createOpportunity(
    principal: Principal,
    input: z.infer<typeof opportunityCreateSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await lockContactDirectory(tx, input.organizationId);
      const relationship = await writableRelationship(
        tx,
        principal,
        input.organizationId,
        input.relationshipId,
        input.productId,
      );
      await assertProductActive(
        tx,
        input.organizationId,
        relationship.productId,
      );
      const stage = await stageFor(
        tx,
        input.organizationId,
        relationship.productId,
        input.stageId,
      );
      const [opportunity] = await tx
        .insert(s.opportunities)
        .values({
          organizationId: input.organizationId,
          productId: relationship.productId,
          relationshipId: relationship.id,
          stageId: input.stageId,
          name: input.name,
          amountMinor: input.amountMinor,
          currency: input.currency,
          ownerId: relationship.ownerId,
          status:
            stage.category === "won"
              ? "won"
              : stage.category === "lost"
                ? "lost"
                : "open",
          probability:
            stage.category === "won"
              ? 100
              : stage.category === "lost"
                ? 0
                : null,
          closedAt:
            stage.category === "won" || stage.category === "lost"
              ? new Date()
              : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: relationship.productId,
        actorId: principal.userId,
        type: "opportunity.created",
        entityId: opportunity.id,
      });
      return opportunity;
    });
  }

  async changeOpportunity(
    principal: Principal,
    input: z.infer<typeof opportunityChangeSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await lockContactDirectory(tx, input.organizationId);
      if (input.stageId)
        await shareLockStage(tx, input.organizationId, input.stageId);
      const [opportunity] = await tx
        .select()
        .from(s.opportunities)
        .where(
          and(
            eq(s.opportunities.id, input.opportunityId),
            eq(s.opportunities.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (!opportunity) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        opportunity.productId,
        true,
      );
      if (input.productId && input.productId !== opportunity.productId)
        throw new DomainError("FORBIDDEN", 403);
      if (opportunity.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      if (opportunity.archivedAt) throw new DomainError("RECORD_ARCHIVED", 409);
      await assertActiveRelationships(tx, input.organizationId, [
        opportunity.relationshipId,
      ]);
      const edited =
        (input.name !== undefined && input.name !== opportunity.name) ||
        (input.amountMinor !== undefined &&
          input.amountMinor !== opportunity.amountMinor) ||
        (input.currency !== undefined &&
          input.currency !== opportunity.currency);
      const moved =
        input.stageId !== undefined && input.stageId !== opportunity.stageId
          ? await stageFor(
              tx,
              input.organizationId,
              opportunity.productId,
              input.stageId,
            )
          : undefined;
      if (!edited && !moved) return opportunity;
      const [updated] = await tx
        .update(s.opportunities)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(moved
            ? {
                stageId: moved.id,
                status:
                  moved.category === "won"
                    ? ("won" as const)
                    : moved.category === "lost"
                      ? ("lost" as const)
                      : ("open" as const),
                probability:
                  moved.category === "won"
                    ? 100
                    : moved.category === "lost"
                      ? 0
                      : opportunity.probability,
                closedAt:
                  moved.category === "won" || moved.category === "lost"
                    ? opportunity.status === moved.category
                      ? (opportunity.closedAt ?? new Date())
                      : new Date()
                    : null,
              }
            : opportunity.status !== "open" && !opportunity.closedAt
              ? { closedAt: new Date() }
              : {}),
          updatedAt: new Date(),
          ...(input.amountMinor !== undefined
            ? { amountMinor: input.amountMinor }
            : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          version: opportunity.version + 1,
        })
        .where(
          and(
            eq(s.opportunities.id, opportunity.id),
            eq(s.opportunities.version, opportunity.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      const types = [
        ...(edited ? ["opportunity.updated"] : []),
        ...(moved ? [stageEvent(moved.category)] : []),
      ];
      if (types.length)
        await tx.insert(s.changeEvents).values(
          types.map((type) => ({
            organizationId: input.organizationId,
            productId: opportunity.productId,
            actorId: principal.userId,
            type,
            entityId: opportunity.id,
          })),
        );
      return updated;
    });
  }

  async archiveOpportunity(
    principal: Principal,
    input: z.infer<typeof opportunityArchiveSchema>,
  ) {
    requireWriteActor(principal);
    return this.db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await lockContactDirectory(tx, input.organizationId);
      const [found] = await tx
        .select()
        .from(s.opportunities)
        .where(
          and(
            eq(s.opportunities.id, input.opportunityId),
            eq(s.opportunities.organizationId, input.organizationId),
          ),
        );
      if (!found) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
      if (input.productId && input.productId !== found.productId)
        throw new DomainError("FORBIDDEN", 403);
      await assertProductActive(tx, input.organizationId, found.productId);
      // Pipeline changes lock stages before deals. Match that order on restore.
      const [stage] = input.archived
        ? []
        : await tx
            .select()
            .from(s.stages)
            .where(
              and(
                eq(s.stages.id, input.stageId ?? found.stageId),
                eq(s.stages.organizationId, input.organizationId),
                eq(s.stages.productId, found.productId),
                eq(s.stages.pipeline, "deal"),
              ),
            )
            .for("share");
      const [opportunity] = await tx
        .select()
        .from(s.opportunities)
        .where(eq(s.opportunities.id, found.id))
        .for("update");
      if (opportunity.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      if (!!opportunity.archivedAt === input.archived) return opportunity;
      if (!input.archived) {
        await assertActiveRelationships(tx, input.organizationId, [
          opportunity.relationshipId,
        ]);
        const category =
          opportunity.status === "open"
            ? ["open", "hold"]
            : [opportunity.status];
        if (!stage || stage.archivedAt || !category.includes(stage.category))
          throw new DomainError("STAGE_REQUIRED", 409);
      }
      const [updated] = await tx
        .update(s.opportunities)
        .set({
          archivedAt: input.archived ? new Date() : null,
          ...(!input.archived && stage ? { stageId: stage.id } : {}),
          version: opportunity.version + 1,
        })
        .where(
          and(
            eq(s.opportunities.id, opportunity.id),
            eq(s.opportunities.version, input.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: opportunity.productId,
        actorId: principal.userId,
        type: input.archived ? "opportunity.archived" : "opportunity.restored",
        entityId: opportunity.id,
      });
      return updated;
    });
  }

  async mergeRecords(
    principal: Principal,
    input: z.infer<typeof mergeRecordsSchema>,
  ) {
    requireWriteActor(principal);
    const result = await this.db.transaction(async (tx) => {
      await lockOrganization(tx, input.organizationId);
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      if (input.targetId === input.sourceId)
        throw new DomainError("CONFLICT", 409);

      const writable = new Set(
        permission.products.map((product) => product.id),
      );

      if (input.entity === "person") {
        const [target] = await tx
          .select()
          .from(s.people)
          .where(
            and(
              eq(s.people.id, input.targetId),
              eq(s.people.organizationId, input.organizationId),
            ),
          )
          .for("update");
        const [source] = await tx
          .select()
          .from(s.people)
          .where(
            and(
              eq(s.people.id, input.sourceId),
              eq(s.people.organizationId, input.organizationId),
            ),
          )
          .for("update");
        if (!target || !source) throw new DomainError("NOT_FOUND", 404);
        if (
          target.version !== input.targetVersion ||
          source.version !== input.sourceVersion
        )
          throw new DomainError("CONFLICT", 409);
        if (target.archivedAt || source.archivedAt)
          throw new DomainError("RECORD_ARCHIVED", 409);
        if (
          !(await personVisible(
            tx,
            [...writable],
            input.organizationId,
            target.id,
          )) ||
          !(await personVisible(
            tx,
            [...writable],
            input.organizationId,
            source.id,
          ))
        )
          throw new DomainError("NOT_FOUND", 404);

        const sourceRelationships = await tx
          .select()
          .from(s.relationships)
          .where(
            and(
              eq(s.relationships.organizationId, input.organizationId),
              eq(s.relationships.personId, source.id),
            ),
          );
        const targetRelationships = await tx
          .select()
          .from(s.relationships)
          .where(
            and(
              eq(s.relationships.organizationId, input.organizationId),
              eq(s.relationships.personId, target.id),
            ),
          );

        const blockedProducts = sourceRelationships
          .map((r) => r.productId)
          .filter((pId) => !writable.has(pId));
        if (blockedProducts.length > 0) throw new DomainError("FORBIDDEN", 403);

        const chosenName = input.name ?? target.name;
        const chosenTitle =
          input.title !== undefined
            ? input.title
            : target.title || source.title;
        const chosenEmail =
          input.email !== undefined
            ? input.email
            : target.email || source.email || null;
        const mergedOther = [
          ...new Set([
            ...(input.otherEmails ?? target.otherEmails),
            ...source.otherEmails,
            ...(target.email && target.email !== chosenEmail
              ? [target.email]
              : []),
            ...(source.email && source.email !== chosenEmail
              ? [source.email]
              : []),
          ]),
        ].filter((e) => e && e !== chosenEmail);
        const chosenOtherEmails =
          input.otherEmails !== undefined ? input.otherEmails : mergedOther;
        const chosenPhone =
          input.phone !== undefined
            ? input.phone
            : target.phone || source.phone;
        const chosenLinkedin =
          input.linkedinUrl !== undefined
            ? input.linkedinUrl
            : target.linkedinUrl || source.linkedinUrl;
        const chosenCompanyId =
          input.companyId !== undefined
            ? input.companyId
            : target.companyId || source.companyId || null;
        const chosenSummary =
          input.summary !== undefined
            ? input.summary
            : target.summary || source.summary;
        const chosenDoNotContact =
          input.doNotContact !== undefined
            ? input.doNotContact
            : target.doNotContact || source.doNotContact;
        const chosenTimeZone =
          input.timeZone !== undefined
            ? input.timeZone
            : target.timeZone || source.timeZone || null;
        const chosenTags =
          input.tags !== undefined
            ? input.tags
            : [...new Set([...target.tags, ...source.tags])];
        const chosenAmount =
          input.amountMinor !== undefined
            ? input.amountMinor
            : (target.amountMinor ?? source.amountMinor);
        const chosenCurrency =
          input.currency ?? target.currency ?? source.currency ?? "USD";

        const allEmails = [
          ...new Set([
            ...(chosenEmail ? [chosenEmail] : []),
            ...chosenOtherEmails,
          ]),
        ];
        if (allEmails.length > 0) {
          const emailTakenOther = await tx
            .select({ id: s.people.id })
            .from(s.people)
            .where(
              and(
                eq(s.people.organizationId, input.organizationId),
                ne(s.people.id, target.id),
                ne(s.people.id, source.id),
                or(
                  inArray(
                    sql`lower(${s.people.email})`,
                    allEmails.map((e) => e.toLowerCase()),
                  ),
                  sql`${s.people.otherEmails} ?| array[${sql.join(
                    allEmails.map((e) => sql`${e.toLowerCase()}`),
                    sql`, `,
                  )}]::text[]`,
                ),
              ),
            )
            .limit(1);
          if (emailTakenOther.length > 0)
            throw new DomainError("PERSON_EXISTS", 409);
        }

        if (chosenLinkedin) {
          const [linkedinTakenOther] = await tx
            .select({ id: s.people.id })
            .from(s.people)
            .where(
              and(
                eq(s.people.organizationId, input.organizationId),
                ne(s.people.id, target.id),
                ne(s.people.id, source.id),
                ne(s.people.linkedinUrl, ""),
                sql`${linkedinKey(s.people.linkedinUrl)} = ${linkedinKey(sql`${chosenLinkedin}`)}`,
              ),
            )
            .limit(1);
          if (linkedinTakenOther) throw new DomainError("PERSON_EXISTS", 409);
        }

        if (chosenCompanyId && chosenCompanyId !== target.companyId) {
          await activeCompany(
            tx,
            [...writable],
            input.organizationId,
            chosenCompanyId,
          );
        }

        for (const sr of sourceRelationships) {
          const tr = targetRelationships.find(
            (r) => r.productId === sr.productId && r.purpose === sr.purpose,
          );
          if (tr) {
            await tx
              .update(s.conversations)
              .set({ relationshipId: tr.id })
              .where(eq(s.conversations.relationshipId, sr.id));
            await tx
              .update(s.actions)
              .set({ relationshipId: tr.id })
              .where(eq(s.actions.relationshipId, sr.id));
            await tx
              .update(s.meetings)
              .set({ relationshipId: tr.id })
              .where(eq(s.meetings.relationshipId, sr.id));
            await tx
              .update(s.opportunities)
              .set({ relationshipId: tr.id })
              .where(eq(s.opportunities.relationshipId, sr.id));
            await tx
              .update(s.internalTasks)
              .set({ relationshipId: tr.id })
              .where(eq(s.internalTasks.relationshipId, sr.id));
            await tx
              .update(s.touches)
              .set({ relationshipId: tr.id })
              .where(eq(s.touches.relationshipId, sr.id));
            await tx
              .update(s.nativeDrafts)
              .set({ relationshipId: tr.id })
              .where(eq(s.nativeDrafts.relationshipId, sr.id));
            await tx
              .update(s.evidence)
              .set({ relationshipId: tr.id })
              .where(eq(s.evidence.relationshipId, sr.id));
            await tx
              .update(s.integrationItems)
              .set({ relationshipId: tr.id })
              .where(eq(s.integrationItems.relationshipId, sr.id));
            await tx
              .update(s.yoduBindings)
              .set({ relationshipId: tr.id })
              .where(eq(s.yoduBindings.relationshipId, sr.id));

            const targetActiveSequences = new Set(
              (
                await tx
                  .select({ sequenceId: s.enrollments.sequenceId })
                  .from(s.enrollments)
                  .where(
                    and(
                      eq(s.enrollments.relationshipId, tr.id),
                      inArray(s.enrollments.status, ["running", "paused"]),
                    ),
                  )
              ).map((e) => e.sequenceId),
            );
            const sourceEnrollments = await tx
              .select()
              .from(s.enrollments)
              .where(eq(s.enrollments.relationshipId, sr.id));
            for (const enc of sourceEnrollments) {
              if (
                targetActiveSequences.has(enc.sequenceId) &&
                (enc.status === "running" || enc.status === "paused")
              ) {
                await tx
                  .update(s.enrollments)
                  .set({
                    status: "stopped",
                    pauseReason: null,
                    relationshipId: tr.id,
                    version: enc.version + 1,
                  })
                  .where(eq(s.enrollments.id, enc.id));
              } else {
                await tx
                  .update(s.enrollments)
                  .set({ relationshipId: tr.id })
                  .where(eq(s.enrollments.id, enc.id));
              }
            }

            await tx
              .delete(s.relationships)
              .where(eq(s.relationships.id, sr.id));
          } else {
            await tx
              .update(s.relationships)
              .set({ personId: target.id, version: sr.version + 1 })
              .where(eq(s.relationships.id, sr.id));
          }
        }

        await tx
          .update(s.contactContributions)
          .set({ personId: target.id })
          .where(eq(s.contactContributions.personId, source.id));

        const [updated] = await tx
          .update(s.people)
          .set({
            name: chosenName,
            title: chosenTitle,
            email: chosenEmail,
            otherEmails: chosenOtherEmails,
            phone: chosenPhone,
            linkedinUrl: chosenLinkedin,
            companyId: chosenCompanyId,
            summary: chosenSummary,
            doNotContact: chosenDoNotContact,
            timeZone: chosenTimeZone,
            tags: chosenTags,
            amountMinor: chosenAmount,
            currency: chosenCurrency,
            version: target.version + 1,
          })
          .where(
            and(
              eq(s.people.id, target.id),
              eq(s.people.version, target.version),
            ),
          )
          .returning();
        if (!updated) throw new DomainError("CONFLICT", 409);

        await tx.delete(s.people).where(eq(s.people.id, source.id));

        await recordContactSubmission(tx, principal, {
          organizationId: input.organizationId,
          personId: target.id,
          kind: "updated",
        });

        await tx.insert(s.changeEvents).values({
          organizationId: input.organizationId,
          actorId: principal.userId,
          type: "person.merged",
          entityId: target.id,
        });

        if (
          (target.email ?? null) !== (updated.email ?? null) ||
          target.name !== updated.name ||
          target.title !== updated.title ||
          (target.companyId ?? null) !== (updated.companyId ?? null)
        ) {
          await clearApprovals(tx, principal, input.organizationId, target.id);
        }

        return updated;
      }

      // Company merge
      const [target] = await tx
        .select()
        .from(s.companies)
        .where(
          and(
            eq(s.companies.id, input.targetId),
            eq(s.companies.organizationId, input.organizationId),
          ),
        )
        .for("update");
      const [source] = await tx
        .select()
        .from(s.companies)
        .where(
          and(
            eq(s.companies.id, input.sourceId),
            eq(s.companies.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (!target || !source) throw new DomainError("NOT_FOUND", 404);
      if (
        target.version !== input.targetVersion ||
        source.version !== input.sourceVersion
      )
        throw new DomainError("CONFLICT", 409);
      if (target.archivedAt || source.archivedAt)
        throw new DomainError("RECORD_ARCHIVED", 409);
      if (
        !(await companyVisible(
          tx,
          [...writable],
          input.organizationId,
          target.id,
        )) ||
        !(await companyVisible(
          tx,
          [...writable],
          input.organizationId,
          source.id,
        ))
      )
        throw new DomainError("NOT_FOUND", 404);

      const chosenName = input.name ?? target.name;
      const chosenDomain =
        input.domain !== undefined
          ? input.domain || null
          : target.domain || source.domain || null;
      const chosenDescription =
        input.description !== undefined
          ? input.description
          : target.description || source.description;
      const chosenTags =
        input.tags !== undefined
          ? input.tags
          : [...new Set([...target.tags, ...source.tags])];
      const chosenAmount =
        input.amountMinor !== undefined
          ? input.amountMinor
          : (target.amountMinor ?? source.amountMinor);
      const chosenCurrency =
        input.currency ?? target.currency ?? source.currency ?? "USD";

      if (chosenDomain) {
        const [duplicateDomain] = await tx
          .select({ id: s.companies.id })
          .from(s.companies)
          .where(
            and(
              eq(s.companies.organizationId, input.organizationId),
              eq(s.companies.domain, chosenDomain),
              isNull(s.companies.archivedAt),
              ne(s.companies.id, target.id),
              ne(s.companies.id, source.id),
            ),
          );
        if (duplicateDomain) throw new DomainError("COMPANY_EXISTS", 409);
      }

      const employees = await tx
        .select({ id: s.people.id, version: s.people.version })
        .from(s.people)
        .where(
          and(
            eq(s.people.organizationId, input.organizationId),
            eq(s.people.companyId, source.id),
          ),
        );
      if (employees.length) {
        await tx
          .update(s.people)
          .set({
            companyId: target.id,
            version: sql`${s.people.version} + 1`,
          })
          .where(
            and(
              eq(s.people.organizationId, input.organizationId),
              eq(s.people.companyId, source.id),
            ),
          );
        for (const emp of employees) {
          await clearApprovals(tx, principal, input.organizationId, emp.id);
        }
      }

      const [updated] = await tx
        .update(s.companies)
        .set({
          name: chosenName,
          domain: chosenDomain,
          description: chosenDescription,
          tags: chosenTags,
          amountMinor: chosenAmount,
          currency: chosenCurrency,
          version: target.version + 1,
        })
        .where(
          and(
            eq(s.companies.id, target.id),
            eq(s.companies.version, target.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);

      await tx.delete(s.companies).where(eq(s.companies.id, source.id));

      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "company.merged",
        entityId: target.id,
      });

      if (target.name !== updated.name) {
        const allEmployees = await tx
          .select({ id: s.people.id })
          .from(s.people)
          .where(
            and(
              eq(s.people.organizationId, input.organizationId),
              eq(s.people.companyId, target.id),
            ),
          );
        for (const employee of allEmployees) {
          await clearApprovals(
            tx,
            principal,
            input.organizationId,
            employee.id,
          );
        }
      }

      return updated;
    });

    publishChange(input.organizationId);
    return result;
  }
}
