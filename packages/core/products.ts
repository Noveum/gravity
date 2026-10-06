import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import {
  authorize,
  authorizeAdministrator,
  DomainError,
  type Principal,
  uniqueViolation,
} from "./policy";
import { productColorKeys } from "./product-colors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

const productScope = z.object({
  organizationId: z.uuid(),
  productId: z.uuid(),
});
export const updateProductSchema = productScope
  .extend({
    name: z.string().trim().min(1).max(100).optional(),
    colorKey: z.enum(productColorKeys).optional(),
  })
  .refine((value) => value.name !== undefined || value.colorKey !== undefined);
export const archiveProductSchema = productScope;
export const restoreProductSchema = productScope;

export async function assertProductActive(
  tx: Transaction,
  organizationId: string,
  productId: string,
) {
  const [product] = await tx
    .select({ archivedAt: s.products.archivedAt })
    .from(s.products)
    .where(
      and(
        eq(s.products.organizationId, organizationId),
        eq(s.products.id, productId),
      ),
    )
    .for("share");
  if (!product) throw new DomainError("NOT_FOUND", 404);
  if (product.archivedAt) throw new DomainError("PRODUCT_ARCHIVED", 409);
}

async function lockProducts(db: Reader, organizationId: string) {
  return db
    .select()
    .from(s.products)
    .where(eq(s.products.organizationId, organizationId))
    .for("update");
}
function findProduct(
  rows: (typeof s.products.$inferSelect)[],
  productId: string,
) {
  const product = rows.find((row) => row.id === productId);
  if (!product) throw new DomainError("NOT_FOUND", 404);
  return product;
}

export class ProductService {
  constructor(private db: Database) {}

  async update(
    principal: Principal,
    input: z.infer<typeof updateProductSchema>,
  ) {
    return this.db
      .transaction(async (tx) => {
        const { membership } = await authorize(
          tx,
          principal,
          input.organizationId,
          input.productId,
          true,
        );
        if (membership.role !== "admin")
          throw new DomainError("FORBIDDEN", 403);
        const [product] = await tx
          .update(s.products)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.colorKey !== undefined
              ? { colorKey: input.colorKey }
              : {}),
          })
          .where(
            and(
              eq(s.products.organizationId, input.organizationId),
              eq(s.products.id, input.productId),
            ),
          )
          .returning();
        if (!product) throw new DomainError("NOT_FOUND", 404);
        await tx.insert(s.changeEvents).values({
          organizationId: input.organizationId,
          productId: product.id,
          actorId: principal.userId,
          type: "product.updated",
          entityId: product.id,
        });
        return product;
      })
      .catch((error: unknown) => {
        if (uniqueViolation(error))
          throw new DomainError("PRODUCT_EXISTS", 409);
        throw error;
      });
  }

  async archive(
    principal: Principal,
    input: z.infer<typeof archiveProductSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeAdministrator(tx, principal, input.organizationId);
      const rows = await lockProducts(tx, input.organizationId);
      const current = findProduct(rows, input.productId);
      if (current.archivedAt) throw new DomainError("PRODUCT_ARCHIVED", 409);
      if (!rows.some((row) => row.id !== current.id && !row.archivedAt))
        throw new DomainError("LAST_ACTIVE_PRODUCT", 409);
      const [product] = await tx
        .update(s.products)
        .set({ archivedAt: new Date() })
        .where(eq(s.products.id, current.id))
        .returning();
      if (!product) throw new DomainError("NOT_FOUND", 404);
      const running = await tx
        .select()
        .from(s.enrollments)
        .where(
          and(
            eq(s.enrollments.organizationId, input.organizationId),
            eq(s.enrollments.productId, current.id),
            eq(s.enrollments.status, "running"),
          ),
        )
        .for("update");
      for (const enrollment of running)
        await tx
          .update(s.enrollments)
          .set({
            status: "paused",
            pauseReason: "manual",
            version: enrollment.version + 1,
          })
          .where(eq(s.enrollments.id, enrollment.id));
      await tx.insert(s.changeEvents).values([
        {
          organizationId: input.organizationId,
          productId: current.id,
          actorId: principal.userId,
          type: "product.archived",
          entityId: current.id,
        },
        ...running.map((enrollment) => ({
          organizationId: input.organizationId,
          productId: current.id,
          actorId: principal.userId,
          type: "enrollment.paused",
          entityId: enrollment.id,
        })),
      ]);
      return { ...product, pausedEnrollments: running.length };
    });
  }

  async restore(
    principal: Principal,
    input: z.infer<typeof restoreProductSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeAdministrator(tx, principal, input.organizationId);
      const rows = await lockProducts(tx, input.organizationId);
      const current = findProduct(rows, input.productId);
      if (!current.archivedAt) throw new DomainError("PRODUCT_ACTIVE", 409);
      const [product] = await tx
        .update(s.products)
        .set({ archivedAt: null })
        .where(eq(s.products.id, current.id))
        .returning();
      if (!product) throw new DomainError("NOT_FOUND", 404);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: current.id,
        actorId: principal.userId,
        type: "product.restored",
        entityId: current.id,
      });
      return product;
    });
  }
}
