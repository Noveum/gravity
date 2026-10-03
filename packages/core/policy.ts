import { and, eq } from "drizzle-orm";
import type { Database } from "../database/client";
import { memberships, productMemberships, products } from "../database/schema";

export interface Principal {
  userId: string;
  source: "session" | "mcp" | "demo";
  organizationId?: string;
  productIds?: string[];
  readOnly?: boolean;
}
export class DomainError extends Error {
  constructor(
    public code: string,
    public status: number,
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
  if (write && principal.readOnly) throw new DomainError("FORBIDDEN", 403);
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
    .select()
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
