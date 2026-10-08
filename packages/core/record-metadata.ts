import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { recordContactSubmission } from "./contact-attribution";
import { scopeSchema } from "./crm";
import { authorize, DomainError, type Principal } from "./policy";
import { tagsSchema } from "./record-tags";
import {
  assertActiveRelationships,
  companyVisible,
  personVisible,
} from "./visibility";
export const recordMetadataSchema = scopeSchema.extend({
  entity: z.enum(["person", "company", "relationship", "opportunity"]),
  recordId: z.uuid(),
  version: z.number().int().positive(),
  tags: tagsSchema,
  amountMinor: z.number().int().min(0).max(2147483647).nullable(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => Intl.supportedValuesOf("currency").includes(value)),
});

export class RecordMetadataService {
  constructor(private db: Database) {}

  async save(
    principal: Principal,
    input: z.infer<typeof recordMetadataSchema>,
  ) {
    if (principal.source === "mcp" && principal.readOnly !== false)
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const table =
        input.entity === "person"
          ? s.people
          : input.entity === "company"
            ? s.companies
            : input.entity === "relationship"
              ? s.relationships
              : s.opportunities;
      const [record] = await tx
        .select()
        .from(table)
        .where(
          and(
            eq(table.id, input.recordId),
            eq(table.organizationId, input.organizationId),
          ),
        )
        .for("update");
      if (!record) throw new DomainError("NOT_FOUND", 404);
      const productId =
        "productId" in record ? record.productId : input.productId;
      if (input.productId && productId !== input.productId)
        throw new DomainError("FORBIDDEN", 403);
      const permission = await authorize(
        tx,
        principal,
        input.organizationId,
        productId,
        true,
      );
      const products = permission.products.map((product) => product.id);
      if (
        input.entity === "person" &&
        !(await personVisible(tx, products, input.organizationId, record.id))
      )
        throw new DomainError("NOT_FOUND", 404);
      if (
        input.entity === "company" &&
        !(await companyVisible(tx, products, input.organizationId, record.id))
      )
        throw new DomainError("NOT_FOUND", 404);
      if ("archivedAt" in record && record.archivedAt)
        throw new DomainError("RECORD_ARCHIVED", 409);
      if ("personId" in record)
        await assertActiveRelationships(tx, input.organizationId, [record.id]);
      if ("relationshipId" in record)
        await assertActiveRelationships(tx, input.organizationId, [
          record.relationshipId,
        ]);
      if (record.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const [updated] = await tx
        .update(table)
        .set({
          tags: input.tags,
          amountMinor: input.amountMinor,
          currency: input.currency,
          version: record.version + 1,
          ...("updatedAt" in record ? { updatedAt: new Date() } : {}),
        })
        .where(
          and(
            eq(table.id, record.id),
            eq(table.organizationId, input.organizationId),
            eq(table.version, input.version),
          ),
        )
        .returning();
      if (!updated) throw new DomainError("CONFLICT", 409);
      if (input.entity === "person")
        await recordContactSubmission(tx, principal, {
          organizationId: input.organizationId,
          personId: record.id,
          kind: "updated",
        });
      if ("personId" in record)
        await recordContactSubmission(tx, principal, {
          organizationId: input.organizationId,
          personId: record.personId,
          productId: record.productId,
          kind: "updated",
        });
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        ...(productId ? { productId } : {}),
        actorId: principal.userId,
        type: `${input.entity}.updated`,
        entityId: record.id,
      });
      return { entity: input.entity, record: updated };
    });
  }
}
