import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { scopeSchema } from "./crm";
import {
  authorize,
  authorizeAdministrator,
  DomainError,
  type Principal,
} from "./policy";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

const memberScope = z.object({
  organizationId: z.uuid(),
  userId: z.string().trim().min(1).max(200),
});
export const memberRoleSchema = memberScope.extend({
  role: z.enum(["admin", "member"]),
});
export const memberProductsSchema = memberScope.extend({
  productIds: z
    .array(z.uuid())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const deactivateMemberSchema = memberScope.extend({
  reassignToUserId: z.string().trim().min(1).max(200).optional(),
});
export const reactivateMemberSchema = memberScope;
export const listMembersSchema = scopeSchema.pick({ organizationId: true });

const openTouchStatuses = ["planned", "drafted", "approved"] as const;
const openActionStatuses = ["open", "blocked"] as const;

async function lockMemberships(db: Reader, organizationId: string) {
  return db
    .select()
    .from(s.memberships)
    .where(eq(s.memberships.organizationId, organizationId))
    .orderBy(s.memberships.id)
    .for("update");
}
function findMember(
  rows: (typeof s.memberships.$inferSelect)[],
  userId: string,
) {
  const member = rows.find((row) => row.userId === userId);
  if (!member) throw new DomainError("NOT_FOUND", 404);
  return member;
}
function assertAnotherAdmin(
  rows: (typeof s.memberships.$inferSelect)[],
  userId: string,
) {
  if (
    !rows.some(
      (row) => row.userId !== userId && row.role === "admin" && row.active,
    )
  )
    throw new DomainError("LAST_ADMIN", 409);
}
export async function assertProductAccess(
  db: Reader,
  organizationId: string,
  userId: string,
  productIds: Iterable<string>,
) {
  for (const productId of new Set(productIds)) {
    try {
      await authorize(
        db,
        { userId, source: "session" },
        organizationId,
        productId,
      );
    } catch (error) {
      if (error instanceof DomainError)
        throw new DomainError("OWNER_NOT_ALLOWED", 403);
      throw error;
    }
  }
}
export class MemberService {
  constructor(private db: Database) {}

  async list(principal: Principal, organizationId: string) {
    const { products } = await authorize(this.db, principal, organizationId);
    const productIds = products.map((product) => product.id);
    const members = await this.db
      .select({
        userId: s.memberships.userId,
        role: s.memberships.role,
        active: s.memberships.active,
        name: s.user.name,
        email: s.user.email,
      })
      .from(s.memberships)
      .innerJoin(s.user, eq(s.user.id, s.memberships.userId))
      .where(eq(s.memberships.organizationId, organizationId))
      .orderBy(s.user.name);
    const grants = await this.db
      .select()
      .from(s.productMemberships)
      .where(eq(s.productMemberships.organizationId, organizationId));
    const counted = async (
      rows: PromiseLike<{ userId: string; count: number }[]>,
    ) => new Map((await rows).map((row) => [row.userId, row.count]));
    const total = sql<number>`count(*)::int`;
    const relationships = await counted(
      this.db
        .select({ userId: s.relationships.ownerId, count: total })
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.organizationId, organizationId),
            inArray(s.relationships.productId, productIds),
          ),
        )
        .groupBy(s.relationships.ownerId),
    );
    const actions = await counted(
      this.db
        .select({ userId: s.actions.ownerId, count: total })
        .from(s.actions)
        .where(
          and(
            eq(s.actions.organizationId, organizationId),
            inArray(s.actions.productId, productIds),
            inArray(s.actions.status, [...openActionStatuses]),
          ),
        )
        .groupBy(s.actions.ownerId),
    );
    const touches = await counted(
      this.db
        .select({ userId: s.touches.senderId, count: total })
        .from(s.touches)
        .where(
          and(
            eq(s.touches.organizationId, organizationId),
            inArray(s.touches.productId, productIds),
            inArray(s.touches.status, [...openTouchStatuses]),
          ),
        )
        .groupBy(s.touches.senderId),
    );
    return {
      members: members.map((member) => ({
        ...member,
        allProducts: member.role === "admin",
        productIds: grants
          .filter(
            (grant) =>
              grant.userId === member.userId &&
              productIds.includes(grant.productId),
          )
          .map((grant) => grant.productId)
          .sort(),
        owned: {
          relationships: relationships.get(member.userId) ?? 0,
          actions: actions.get(member.userId) ?? 0,
          touches: touches.get(member.userId) ?? 0,
        },
      })),
    };
  }

  async changeRole(
    principal: Principal,
    input: z.infer<typeof memberRoleSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeAdministrator(tx, principal, input.organizationId);
      const rows = await lockMemberships(tx, input.organizationId);
      const member = findMember(rows, input.userId);
      if (member.role === input.role) return member;
      if (member.role === "admin" && member.active)
        assertAnotherAdmin(rows, member.userId);
      const [updated] = await tx
        .update(s.memberships)
        .set({ role: input.role })
        .where(eq(s.memberships.id, member.id))
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "member.role_changed",
        entityId: member.id,
      });
      return updated;
    });
  }

  async setProducts(
    principal: Principal,
    input: z.infer<typeof memberProductsSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeAdministrator(tx, principal, input.organizationId);
      const member = findMember(
        await lockMemberships(tx, input.organizationId),
        input.userId,
      );
      const found = input.productIds.length
        ? await tx
            .select({ id: s.products.id })
            .from(s.products)
            .where(
              and(
                eq(s.products.organizationId, input.organizationId),
                inArray(s.products.id, input.productIds),
              ),
            )
        : [];
      if (found.length !== input.productIds.length)
        throw new DomainError("NOT_FOUND", 404);
      await tx
        .delete(s.productMemberships)
        .where(
          and(
            eq(s.productMemberships.organizationId, input.organizationId),
            eq(s.productMemberships.userId, member.userId),
          ),
        );
      if (input.productIds.length)
        await tx.insert(s.productMemberships).values(
          input.productIds.map((productId) => ({
            organizationId: input.organizationId,
            productId,
            userId: member.userId,
          })),
        );
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "member.products_changed",
        entityId: member.id,
      });
      return {
        userId: member.userId,
        productIds: [...input.productIds].sort(),
      };
    });
  }

  async deactivate(
    principal: Principal,
    input: z.infer<typeof deactivateMemberSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeAdministrator(tx, principal, input.organizationId);
      const rows = await lockMemberships(tx, input.organizationId);
      const member = findMember(rows, input.userId);
      if (!member.active) throw new DomainError("MEMBER_INACTIVE", 409);
      if (member.role === "admin") assertAnotherAdmin(rows, member.userId);
      const targetId = input.reassignToUserId ?? principal.userId;
      const target = rows.find((row) => row.userId === targetId);
      if (!target?.active || target.userId === member.userId)
        throw new DomainError("REASSIGN_TARGET_INVALID", 409);
      const organizationId = input.organizationId;
      const relationships = await tx
        .select({
          id: s.relationships.id,
          productId: s.relationships.productId,
        })
        .from(s.relationships)
        .where(
          and(
            eq(s.relationships.organizationId, organizationId),
            eq(s.relationships.ownerId, member.userId),
          ),
        )
        .for("update");
      const actions = await tx
        .select({
          id: s.actions.id,
          productId: s.actions.productId,
          sourceConversationId: s.actions.sourceConversationId,
          visibility: s.conversations.visibility,
        })
        .from(s.actions)
        .leftJoin(
          s.conversations,
          eq(s.conversations.id, s.actions.sourceConversationId),
        )
        .where(
          and(
            eq(s.actions.organizationId, organizationId),
            eq(s.actions.ownerId, member.userId),
            inArray(s.actions.status, [...openActionStatuses]),
          ),
        )
        .for("update", { of: s.actions });
      const shared = actions.filter(
        (action) => action.visibility !== "private",
      );
      const touches = await tx
        .select({ id: s.touches.id, productId: s.touches.productId })
        .from(s.touches)
        .where(
          and(
            eq(s.touches.organizationId, organizationId),
            eq(s.touches.senderId, member.userId),
            inArray(s.touches.status, [...openTouchStatuses]),
          ),
        )
        .for("update");
      await assertProductAccess(tx, organizationId, target.userId, [
        ...relationships.map((row) => row.productId),
        ...shared.map((row) => row.productId),
        ...touches.map((row) => row.productId),
      ]);
      if (relationships.length)
        await tx
          .update(s.relationships)
          .set({
            ownerId: target.userId,
            version: sql`${s.relationships.version} + 1`,
          })
          .where(
            inArray(
              s.relationships.id,
              relationships.map((row) => row.id),
            ),
          );
      if (shared.length)
        await tx
          .update(s.actions)
          .set({
            ownerId: target.userId,
            approvedHash: null,
            approvedBy: null,
            version: sql`${s.actions.version} + 1`,
          })
          .where(
            inArray(
              s.actions.id,
              shared.map((row) => row.id),
            ),
          );
      const moved = await reassignTouches(
        tx,
        principal.userId,
        organizationId,
        target.userId,
        { fromSenderId: member.userId },
      );
      await tx
        .update(s.memberships)
        .set({ active: false })
        .where(eq(s.memberships.id, member.id));
      const revoked = await tx
        .update(s.mcpGrants)
        .set({ active: false })
        .where(
          and(
            eq(s.mcpGrants.organizationId, organizationId),
            eq(s.mcpGrants.userId, member.userId),
            eq(s.mcpGrants.active, true),
          ),
        )
        .returning({ id: s.mcpGrants.id });
      await tx.insert(s.changeEvents).values([
        {
          organizationId,
          actorId: principal.userId,
          type: "member.deactivated",
          entityId: member.id,
        },
        ...relationships.map((row) => ({
          organizationId,
          productId: row.productId,
          actorId: principal.userId,
          type: "relationship.owner_changed",
          entityId: row.id,
        })),
        ...shared.map((row) => ({
          organizationId,
          productId: row.productId,
          sourceConversationId: row.sourceConversationId,
          actorId: principal.userId,
          type: "action.assign",
          entityId: row.id,
        })),
      ]);
      return {
        userId: member.userId,
        active: false,
        reassignedTo: target.userId,
        reassigned: {
          relationships: relationships.length,
          actions: shared.length,
          touches: moved,
        },
        privateActionsKept: actions.length - shared.length,
        revokedGrants: revoked.length,
      };
    });
  }

  async reactivate(
    principal: Principal,
    input: z.infer<typeof reactivateMemberSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeAdministrator(tx, principal, input.organizationId);
      const member = findMember(
        await lockMemberships(tx, input.organizationId),
        input.userId,
      );
      if (member.active) throw new DomainError("MEMBER_ACTIVE", 409);
      await tx
        .update(s.memberships)
        .set({ active: true })
        .where(eq(s.memberships.id, member.id));
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "member.reactivated",
        entityId: member.id,
      });
      return { userId: member.userId, active: true };
    });
  }
}

export async function reassignTouches(
  db: Reader,
  actorId: string,
  organizationId: string,
  senderId: string,
  scope: { relationshipId?: string; fromSenderId?: string },
) {
  const open = await db
    .select()
    .from(s.touches)
    .where(
      and(
        eq(s.touches.organizationId, organizationId),
        inArray(s.touches.status, [...openTouchStatuses]),
        ne(s.touches.senderId, senderId),
        ...(scope.relationshipId
          ? [eq(s.touches.relationshipId, scope.relationshipId)]
          : []),
        ...(scope.fromSenderId
          ? [eq(s.touches.senderId, scope.fromSenderId)]
          : []),
      ),
    )
    .for("update");
  for (const touch of open) {
    const invalidated =
      touch.status === "approved" ||
      touch.approvedHash !== null ||
      touch.approvedBy !== null;
    await db
      .update(s.touches)
      .set({
        senderId,
        status: touch.status === "approved" ? "drafted" : touch.status,
        approvedHash: null,
        approvedBy: null,
        version: touch.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(s.touches.id, touch.id), eq(s.touches.version, touch.version)),
      );
    await db.insert(s.changeEvents).values([
      {
        organizationId,
        productId: touch.productId,
        actorId,
        type: "touch.sender_changed",
        entityId: touch.id,
      },
      ...(invalidated
        ? [
            {
              organizationId,
              productId: touch.productId,
              actorId,
              type: "touch.approval_invalidated",
              entityId: touch.id,
            },
          ]
        : []),
    ]);
  }
  return open.length;
}
