import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { scopeSchema } from "./crm";
import { authorize, DomainError, type Principal } from "./policy";
import {
  activeCompany,
  assertActiveRelationships,
  clearApprovals,
  companyVisible,
  emailTaken,
  lockOrganization,
  personVisible,
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
  summary: z.string().trim().max(10000).default(""),
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

function requireHuman(principal: Principal) {
  if (principal.source === "mcp")
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
      archivedAt: s.people.archivedAt,
    })
    .from(s.relationships)
    .innerJoin(s.people, eq(s.people.id, s.relationships.personId))
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
  if (relationship.archivedAt) throw new DomainError("RECORD_ARCHIVED", 409);
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
      ),
    );
  if (!stage) throw new DomainError("NOT_FOUND", 404);
  return stage;
}

const stageEvent = (category: "open" | "won" | "lost") =>
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
    requireHuman(principal);
    return this.db.transaction(async (tx) => {
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      const productIds = permission.products.map((product) => product.id);
      await lockOrganization(tx, input.organizationId);
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
          summary: input.summary,
          version: person.version + 1,
        })
        .where(
          and(eq(s.people.id, person.id), eq(s.people.version, input.version)),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "person.updated",
        entityId: person.id,
      });
      if ((person.email ?? null) !== (input.email ?? null))
        await clearApprovals(tx, principal, input.organizationId, person.id);
      return updated;
    });
  }

  async archivePerson(
    principal: Principal,
    input: z.infer<typeof personArchiveSchema>,
  ) {
    requireHuman(principal);
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
                status: "paused_archived",
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
    requireHuman(principal);
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
        const [duplicate] = await tx
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
        if (duplicate) throw new DomainError("COMPANY_EXISTS", 409);
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
      return saved;
    });
  }

  async archiveCompany(
    principal: Principal,
    input: z.infer<typeof companyArchiveSchema>,
  ) {
    requireHuman(principal);
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
    requireHuman(principal);
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
    requireHuman(principal);
    return this.db.transaction(async (tx) => {
      const relationship = await writableRelationship(
        tx,
        principal,
        input.organizationId,
        input.relationshipId,
        input.productId,
      );
      await stageFor(
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
    requireHuman(principal);
    return this.db.transaction(async (tx) => {
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
          ...(moved ? { stageId: moved.id } : {}),
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
}
