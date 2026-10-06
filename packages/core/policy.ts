import { and, eq } from "drizzle-orm";
import type { Database } from "../database/client";
import { memberships, productMemberships, products } from "../database/schema";

export const productColumns = {
  id: products.id,
  organizationId: products.organizationId,
  name: products.name,
  colorKey: products.colorKey,
  archivedAt: products.archivedAt,
  createdAt: products.createdAt,
};

export interface Principal {
  userId: string;
  source: "session" | "mcp" | "demo";
  organizationId?: string;
  productIds?: string[];
  readOnly?: boolean;
  // Set only from a verified OAuth scope. A historical read/write grant never authorizes dispatch.
  canSend?: boolean;
}
// A deliberate organization-wide grant. Empty and historical UUID lists stay restricted.
export const allProductsGrant = ["*"];
export function isAllProductsGrant(productIds: string[]) {
  return productIds.length === 1 && productIds[0] === "*";
}
export function grantedProductIds(productIds: string[]) {
  return isAllProductsGrant(productIds) ? undefined : productIds;
}
export class DomainError extends Error {
  constructor(
    public code: string,
    public status: number,
    public details?: Record<string, string | number>,
  ) {
    super(code);
  }
}
export async function authorize(
  db: Database,
  principal: Principal,
  organizationId: string,
  productId?: string,
  write = false,
) {
  if (principal.organizationId && principal.organizationId !== organizationId)
    throw new DomainError("FORBIDDEN", 403);
  if (
    write &&
    (principal.readOnly ||
      (principal.source === "mcp" && principal.readOnly !== false))
  )
    throw new DomainError("FORBIDDEN", 403);
  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, principal.userId),
        eq(memberships.active, true),
      ),
    );
  if (!membership) throw new DomainError("FORBIDDEN", 403);
  let allowed = await db
    .select(productColumns)
    .from(products)
    .where(eq(products.organizationId, organizationId));
  if (membership.role !== "admin") {
    const memberProducts = await db
      .select()
      .from(productMemberships)
      .where(
        and(
          eq(productMemberships.organizationId, organizationId),
          eq(productMemberships.userId, principal.userId),
        ),
      );
    allowed = allowed.filter((product) =>
      memberProducts.some((p) => p.productId === product.id),
    );
  }
  if (principal.productIds)
    allowed = allowed.filter((product) =>
      principal.productIds?.includes(product.id),
    );
  if (productId && !allowed.some((product) => product.id === productId))
    throw new DomainError("FORBIDDEN", 403);
  return { membership, products: allowed };
}
export async function authorizeAdministrator(
  db: Database,
  principal: Principal,
  organizationId: string,
  write = true,
) {
  const permission = await authorize(
    db,
    principal,
    organizationId,
    undefined,
    write,
  );
  if (
    permission.membership.role !== "admin" ||
    principal.productIds !== undefined
  )
    throw new DomainError("FORBIDDEN", 403);
  return permission;
}
export function uniqueViolation(error: unknown) {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (
    (error as { code?: string }).code === "23505" || cause?.code === "23505"
  );
}
