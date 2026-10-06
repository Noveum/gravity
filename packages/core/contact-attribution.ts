import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import { lockOrganization, personVisible } from "./visibility";

const scope = z.object({
  organizationId: z.uuid(),
  productId: z.uuid().optional(),
});
export const importSourceSchema = z
  .object({
    batchId: z.uuid(),
    sourceRecordId: z.string().trim().min(1).max(200),
  })
  .strict();
export const importBatchSchema = scope.extend({
  productId: z.uuid(),
  submissionKey: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(150),
  sourceKind: z.enum(["file", "agent", "manual"]),
  sourceMemberId: z.string().min(1).max(200).nullable().default(null),
});
export const contactImportSchema = scope.extend({
  productId: z.uuid(),
  personId: z.uuid(),
  version: z.number().int().positive(),
  ...importSourceSchema.shape,
});
export const attributionListSchema = scope.extend({
  personId: z.uuid(),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const attributionHash = (input: object) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

// Connections are private even when their contacts are shared. Only attribution
// whose product AND source account are readable can participate in a read/filter.
export function readableAttribution(
  principal: Principal,
  organizationId: string,
  productIds: string[],
  personId?: string,
) {
  return and(
    eq(s.contactContributions.organizationId, organizationId),
    sql`EXISTS (SELECT 1 FROM ${s.relationships} WHERE ${s.relationships.organizationId} = ${organizationId} AND ${s.relationships.personId} = ${s.contactContributions.personId} AND ${inArray(s.relationships.productId, productIds)})`,
    personId ? eq(s.contactContributions.personId, personId) : undefined,
    or(
      isNull(s.contactContributions.productId),
      inArray(s.contactContributions.productId, productIds),
    ),
    or(
      isNull(s.contactContributions.connectionId),
      eq(s.contactContributions.sourceMemberId, principal.userId),
    ),
  );
}

export async function importSubmission(
  db: Database,
  principal: Principal,
  organizationId: string,
  productId: string,
  source: z.infer<typeof importSourceSchema> | undefined,
  requestHash: string,
) {
  if (!source) return null;
  const [batch] = await db
    .select()
    .from(s.contactImportBatches)
    .where(
      and(
        eq(s.contactImportBatches.id, source.batchId),
        eq(s.contactImportBatches.organizationId, organizationId),
        eq(s.contactImportBatches.productId, productId),
        eq(s.contactImportBatches.submittedBy, principal.userId),
      ),
    )
    .for("share");
  if (!batch) throw new DomainError("NOT_FOUND", 404);
  const [previous] = await db
    .select()
    .from(s.contactContributions)
    .where(
      and(
        eq(s.contactContributions.batchId, batch.id),
        eq(s.contactContributions.sourceRecordId, source.sourceRecordId),
        eq(s.contactContributions.organizationId, organizationId),
      ),
    );
  if (previous && previous.requestHash !== requestHash)
    throw new DomainError("IMPORT_SOURCE_CONFLICT", 409);
  return { batch, previous };
}

export async function recordContactSubmission(
  db: Database,
  principal: Principal,
  input: {
    organizationId: string;
    personId: string;
    productId?: string;
    kind: "created" | "submitted" | "updated";
    submission?: Awaited<ReturnType<typeof importSubmission>>;
    sourceRecordId?: string;
    requestHash?: string;
  },
) {
  const [row] = await db
    .insert(s.contactContributions)
    .values({
      organizationId: input.organizationId,
      personId: input.personId,
      productId: input.productId ?? null,
      kind: input.kind,
      actorId: principal.userId,
      sourceMemberId: input.submission?.batch.sourceMemberId ?? null,
      transport: principal.source,
      clientId:
        principal.source === "mcp" ? (principal.clientId ?? null) : null,
      grantId: principal.source === "mcp" ? (principal.grantId ?? null) : null,
      batchId: input.submission?.batch.id ?? null,
      sourceRecordId: input.sourceRecordId ?? null,
      requestHash: input.submission ? input.requestHash : null,
    })
    .returning();
  return row;
}

export async function recordProviderContribution(
  db: Database,
  connection: typeof s.connections.$inferSelect,
  input: {
    personId: string;
    productId: string;
    sourceRecordId: string;
    sourceConversationId?: string;
    linkedByMember?: boolean;
    linkedBy?: Principal;
  },
) {
  // Source owner is not a human submitting each background sync. No private
  // message contents, addresses, external account handles or credentials here.
  const [recorded] = await db
    .insert(s.contactContributions)
    .values({
      organizationId: connection.organizationId,
      personId: input.personId,
      productId: input.productId,
      kind: "provider_import",
      actorId:
        input.linkedBy?.userId ??
        (input.linkedByMember ? connection.ownerId : null),
      sourceMemberId: connection.ownerId,
      transport:
        input.linkedBy?.source ?? (input.linkedByMember ? "session" : "system"),
      clientId:
        input.linkedBy?.source === "mcp" ? input.linkedBy.clientId : null,
      grantId: input.linkedBy?.source === "mcp" ? input.linkedBy.grantId : null,
      connectionId: connection.id,
      provider: connection.provider,
      sourceRecordId: input.sourceRecordId,
      sourceConversationId: input.sourceConversationId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: s.contactContributions.id });
  if (!recorded) {
    const [previous] = await db
      .select({
        personId: s.contactContributions.personId,
        productId: s.contactContributions.productId,
      })
      .from(s.contactContributions)
      .where(
        and(
          eq(s.contactContributions.connectionId, connection.id),
          eq(s.contactContributions.sourceRecordId, input.sourceRecordId),
        ),
      );
    if (
      !previous ||
      previous.personId !== input.personId ||
      previous.productId !== input.productId
    )
      throw new DomainError("IMPORT_SOURCE_CONFLICT", 409);
  }
}

export class ContactAttributionService {
  constructor(private db: Database) {}

  async createBatch(
    principal: Principal,
    supplied: z.input<typeof importBatchSchema>,
  ) {
    const input = importBatchSchema.parse(supplied);
    return this.db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await assertProductActive(tx, input.organizationId, input.productId);
      await lockOrganization(tx, input.organizationId);
      if (input.sourceMemberId) {
        try {
          await authorize(
            tx,
            { userId: input.sourceMemberId, source: "session" },
            input.organizationId,
            input.productId,
          );
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          throw new DomainError("SOURCE_MEMBER_NOT_ALLOWED", 403);
        }
      }
      const [previous] = await tx
        .select()
        .from(s.contactImportBatches)
        .where(
          and(
            eq(s.contactImportBatches.organizationId, input.organizationId),
            eq(s.contactImportBatches.submittedBy, principal.userId),
            eq(s.contactImportBatches.submissionKey, input.submissionKey),
          ),
        );
      if (previous) {
        if (
          previous.productId !== input.productId ||
          previous.label !== input.label ||
          previous.sourceKind !== input.sourceKind ||
          previous.sourceMemberId !== input.sourceMemberId
        )
          throw new DomainError("IMPORT_SOURCE_CONFLICT", 409);
        return previous;
      }
      const [batch] = await tx
        .insert(s.contactImportBatches)
        .values({
          ...input,
          submittedBy: principal.userId,
          transport: principal.source,
          clientId: principal.source === "mcp" ? principal.clientId : null,
          grantId: principal.source === "mcp" ? principal.grantId : null,
        })
        .returning();
      return batch;
    });
  }

  async recordImport(
    principal: Principal,
    supplied: z.input<typeof contactImportSchema>,
  ) {
    const input = contactImportSchema.parse(supplied);
    return this.db.transaction(async (tx) => {
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await assertProductActive(tx, input.organizationId, input.productId);
      await lockOrganization(tx, input.organizationId);
      const [person] = await tx
        .select()
        .from(s.people)
        .where(
          and(
            eq(s.people.organizationId, input.organizationId),
            eq(s.people.id, input.personId),
          ),
        )
        .for("update");
      if (
        !person ||
        !(await personVisible(
          tx,
          permission.products.map((p) => p.id),
          input.organizationId,
          input.personId,
        ))
      )
        throw new DomainError("NOT_FOUND", 404);
      const [relationship] = await tx
        .select({ id: s.relationships.id })
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.organizationId, input.organizationId),
            eq(s.relationships.productId, input.productId),
            eq(s.relationships.personId, person.id),
          ),
        );
      if (!relationship) throw new DomainError("NOT_FOUND", 404);
      if (person.archivedAt) throw new DomainError("RECORD_ARCHIVED", 409);
      const hash = attributionHash({
        operation: "record-import",
        ...input,
        version: undefined,
      });
      const submission = await importSubmission(
        tx,
        principal,
        input.organizationId,
        input.productId,
        input,
        hash,
      );
      if (submission?.previous) return submission.previous;
      if (person.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const contribution = await recordContactSubmission(tx, principal, {
        ...input,
        kind: "submitted",
        submission,
        requestHash: hash,
      });
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: "person.import-attributed",
        entityId: person.id,
      });
      return contribution;
    });
  }

  async list(
    principal: Principal,
    supplied: z.input<typeof attributionListSchema>,
  ) {
    const input = attributionListSchema.parse(supplied);
    const permission = await authorize(
      this.db,
      principal,
      input.organizationId,
      input.productId,
    );
    const ids = permission.products
      .filter((p) => !input.productId || p.id === input.productId)
      .map((p) => p.id);
    if (
      !(await personVisible(this.db, ids, input.organizationId, input.personId))
    )
      throw new DomainError("NOT_FOUND", 404);
    const [person] = await this.db
      .select({ archivedAt: s.people.archivedAt })
      .from(s.people)
      .where(
        and(
          eq(s.people.organizationId, input.organizationId),
          eq(s.people.id, input.personId),
        ),
      );
    if (
      principal.source === "mcp" &&
      principal.readOnly !== false &&
      person?.archivedAt
    )
      throw new DomainError("NOT_FOUND", 404);
    const where = readableAttribution(
      principal,
      input.organizationId,
      ids,
      input.personId,
    );
    const rows = await this.rows(where, input.limit + 1, input.offset);
    const [creator] = await this.rows(
      and(where, eq(s.contactContributions.kind, "created")),
      1,
      0,
    );
    const [lastEditor] = await this.rows(
      and(where, eq(s.contactContributions.kind, "updated")),
      1,
      0,
    );
    return {
      creator: creator ?? null,
      lastEditor: lastEditor ?? null,
      items: rows.slice(0, input.limit),
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
      coverage: "RECORDED_SUBMISSIONS_ONLY" as const,
    };
  }

  async summaries(principal: Principal, organizationId: string, ids: string[]) {
    // Compact identifiers for list filters; private source identifiers are never
    // included in snapshots. Product authorization is established by the caller.
    return this.db
      .selectDistinct({
        personId: s.contactContributions.personId,
        productId: s.contactContributions.productId,
        actorId: s.contactContributions.actorId,
        sourceMemberId: s.contactContributions.sourceMemberId,
      })
      .from(s.contactContributions)
      .where(
        and(
          readableAttribution(principal, organizationId, ids),
          sql`EXISTS (SELECT 1 FROM ${s.people} WHERE ${s.people.id} = ${s.contactContributions.personId} AND ${s.people.organizationId} = ${organizationId} AND ${s.people.archivedAt} IS NULL)`,
          inArray(s.contactContributions.kind, [
            "created",
            "submitted",
            "provider_import",
          ]),
        ),
      );
  }

  private async rows(where: SQL | undefined, limit: number, offset: number) {
    const rows = await this.db
      .select({
        id: s.contactContributions.id,
        personId: s.contactContributions.personId,
        productId: s.contactContributions.productId,
        actorId: s.contactContributions.actorId,
        sourceMemberId: s.contactContributions.sourceMemberId,
        kind: s.contactContributions.kind,
        transport: s.contactContributions.transport,
        clientId: s.contactContributions.clientId,
        grantId: s.contactContributions.grantId,
        sourceRecordId: s.contactContributions.sourceRecordId,
        provider: s.contactContributions.provider,
        createdAt: s.contactContributions.createdAt,
        batchId: s.contactContributions.batchId,
        batchLabel: s.contactImportBatches.label,
        sourceKind: s.contactImportBatches.sourceKind,
      })
      .from(s.contactContributions)
      .leftJoin(
        s.contactImportBatches,
        and(
          eq(s.contactImportBatches.id, s.contactContributions.batchId),
          eq(
            s.contactImportBatches.organizationId,
            s.contactContributions.organizationId,
          ),
        ),
      )
      .where(where)
      .orderBy(
        desc(s.contactContributions.createdAt),
        desc(s.contactContributions.id),
      )
      .limit(limit)
      .offset(offset);
    const userIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.actorId, r.sourceMemberId])
          .filter((id): id is string => !!id),
      ),
    ];
    const users = userIds.length
      ? await this.db
          .select({ id: s.user.id, name: s.user.name })
          .from(s.user)
          .where(inArray(s.user.id, userIds))
          .orderBy(asc(s.user.id))
      : [];
    return rows.map((row) => ({
      ...row,
      actorName: users.find((u) => u.id === row.actorId)?.name ?? null,
      sourceMemberName:
        users.find((u) => u.id === row.sourceMemberId)?.name ?? null,
    }));
  }
}
