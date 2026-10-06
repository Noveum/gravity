import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { publishChange } from "./changes";
import {
  authorize,
  authorizeAdministrator,
  DomainError,
  type Principal,
} from "./policy";

export const listAssistantGrantsSchema = z.object({
  organizationId: z.uuid(),
});
export const revokeAssistantSchema = z.object({
  organizationId: z.uuid().optional(),
  grantId: z.uuid(),
});

export async function listAssistantGrants(
  db: Database,
  principal: Principal,
  organizationId: string,
) {
  const { membership } = await authorize(db, principal, organizationId);
  if (membership.role !== "admin" || principal.productIds !== undefined)
    throw new DomainError("FORBIDDEN", 403);
  const rows = await db
    .select({
      id: s.mcpGrants.id,
      userId: s.mcpGrants.userId,
      name: s.user.name,
      email: s.user.email,
      productIds: s.mcpGrants.productIds,
      createdAt: s.mcpGrants.createdAt,
    })
    .from(s.mcpGrants)
    .innerJoin(s.user, eq(s.user.id, s.mcpGrants.userId))
    .where(
      and(
        eq(s.mcpGrants.organizationId, organizationId),
        eq(s.mcpGrants.active, true),
      ),
    )
    .orderBy(asc(s.mcpGrants.createdAt), asc(s.mcpGrants.id));
  return {
    grants: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function revokeAssistantGrant(
  db: Database,
  principal: Principal,
  input: z.infer<typeof revokeAssistantSchema>,
) {
  const [grant] = await db
    .select()
    .from(s.mcpGrants)
    .where(eq(s.mcpGrants.id, input.grantId));
  if (!grant) throw new DomainError("NOT_FOUND", 404);
  const own = grant.userId === principal.userId;
  if (own) {
    if (principal.source === "mcp")
      await authorize(db, principal, grant.organizationId, undefined, true);
  } else {
    if (principal.source === "mcp") throw new DomainError("NOT_FOUND", 404);
    try {
      await authorizeAdministrator(db, principal, grant.organizationId);
    } catch (error) {
      if (error instanceof DomainError) throw new DomainError("NOT_FOUND", 404);
      throw error;
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(s.mcpGrants)
      .set({ active: false })
      .where(eq(s.mcpGrants.id, grant.id));
    await tx.insert(s.changeEvents).values({
      organizationId: grant.organizationId,
      actorId: principal.userId,
      type: "assistant.revoked",
      entityId: grant.id,
    });
  });
  publishChange(grant.organizationId);
  return { revoked: true };
}
