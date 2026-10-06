import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { authorize, DomainError, type Principal } from "./policy";
import { lockOrganization } from "./visibility";

export const organizationScope = z.object({ organizationId: z.uuid() });
const access = {
  role: z.enum(["admin", "member"]),
  productIds: z
    .array(z.uuid())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
};
export const inviteSchema = organizationScope
  .extend({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    ...access,
  })
  .refine((input) => input.role === "admin" || input.productIds.length > 0);
export const revokeInviteSchema = organizationScope.extend({
  invitationId: z.uuid(),
});
export const acceptInviteSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export const removeMemberSchema = organizationScope.extend({
  userId: z.string().min(1).max(200),
});
export const memberAccessSchema = organizationScope
  .extend({
    userId: z.string().min(1).max(200),
    ...access,
  })
  .refine((input) => input.role === "admin" || input.productIds.length > 0);
export const organizationSettingsSchema = organizationScope.extend({
  name: z.string().trim().min(1).max(100),
  timezone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
});

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

async function administrator(
  db: Database,
  principal: Principal,
  organizationId: string,
  write = true,
) {
  const { membership, products } = await authorize(
    db,
    principal,
    organizationId,
    undefined,
    write,
  );
  if (membership.role !== "admin" || principal.productIds !== undefined)
    throw new DomainError("FORBIDDEN", 403);
  return products;
}

function validateProducts(products: { id: string }[], ids: string[]) {
  if (ids.some((id) => !products.some((product) => product.id === id)))
    throw new DomainError("FORBIDDEN", 403);
}

export class OrganizationSettingsService {
  constructor(
    private db: Database,
    private clock: () => number = Date.now,
  ) {}

  async invitations(
    principal: Principal,
    input: z.infer<typeof organizationScope>,
  ) {
    const { organizationId } = organizationScope.parse(input);
    await administrator(this.db, principal, organizationId, false);
    return this.db
      .select({
        id: s.invitations.id,
        email: s.invitations.email,
        role: s.invitations.role,
        productIds: s.invitations.productIds,
        expiresAt: s.invitations.expiresAt,
      })
      .from(s.invitations)
      .where(
        and(
          eq(s.invitations.organizationId, organizationId),
          isNull(s.invitations.acceptedAt),
          isNull(s.invitations.revokedAt),
          gt(s.invitations.expiresAt, new Date(this.clock())),
        ),
      )
      .orderBy(s.invitations.createdAt);
  }

  async preview(
    principal: Principal,
    input: z.infer<typeof acceptInviteSchema>,
  ) {
    const { token } = acceptInviteSchema.parse(input);
    if (
      principal.source === "mcp" ||
      principal.organizationId ||
      principal.productIds
    )
      throw new DomainError("FORBIDDEN", 403);
    const [invitation] = await this.db
      .select()
      .from(s.invitations)
      .where(eq(s.invitations.tokenHash, tokenHash(token)));
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= this.clock()
    )
      throw new DomainError("INVITE_UNAVAILABLE", 409);
    const [account] = await this.db
      .select()
      .from(s.user)
      .where(eq(s.user.id, principal.userId));
    if (
      !account?.emailVerified ||
      account.email.toLowerCase() !== invitation.email
    )
      throw new DomainError("INVITE_EMAIL_MISMATCH", 403);
    const [organization] = await this.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, invitation.organizationId));
    const products = await this.db
      .select({ id: s.products.id, name: s.products.name })
      .from(s.products)
      .where(eq(s.products.organizationId, invitation.organizationId));
    return {
      organizationName: organization.name,
      email: invitation.email,
      role: invitation.role,
      products: products
        .filter(
          (product) =>
            invitation.role === "admin" ||
            invitation.productIds.includes(product.id),
        )
        .map((product) => product.name),
    };
  }

  async invite(principal: Principal, input: z.infer<typeof inviteSchema>) {
    const values = inviteSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, values.organizationId);
      const products = await administrator(
        tx,
        principal,
        values.organizationId,
      );
      validateProducts(products, values.productIds);
      const [existing] = await tx
        .select({ id: s.memberships.id })
        .from(s.memberships)
        .innerJoin(s.user, eq(s.user.id, s.memberships.userId))
        .where(
          and(
            eq(s.memberships.organizationId, values.organizationId),
            eq(s.memberships.active, true),
            sql`lower(${s.user.email}) = ${values.email}`,
          ),
        );
      if (existing) throw new DomainError("MEMBER_EXISTS", 409);
      const now = new Date(this.clock());
      await tx
        .update(s.invitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(s.invitations.organizationId, values.organizationId),
            eq(s.invitations.email, values.email),
            isNull(s.invitations.acceptedAt),
            isNull(s.invitations.revokedAt),
          ),
        );
      const token = randomBytes(32).toString("hex");
      const [invitation] = await tx
        .insert(s.invitations)
        .values({
          ...values,
          productIds: values.role === "admin" ? [] : values.productIds,
          tokenHash: tokenHash(token),
          inviterId: principal.userId,
          expiresAt: new Date(this.clock() + 14 * 24 * 60 * 60 * 1000),
        })
        .returning({
          id: s.invitations.id,
          expiresAt: s.invitations.expiresAt,
        });
      if (!invitation) throw new DomainError("INTERNAL_ERROR", 500);
      await tx.insert(s.changeEvents).values({
        organizationId: values.organizationId,
        actorId: principal.userId,
        type: "invitation.created",
        entityId: invitation.id,
      });
      return { ...invitation, token };
    });
  }

  async revoke(
    principal: Principal,
    input: z.infer<typeof revokeInviteSchema>,
  ) {
    const values = revokeInviteSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, values.organizationId);
      await administrator(tx, principal, values.organizationId);
      const revoked = await tx
        .update(s.invitations)
        .set({ revokedAt: new Date(this.clock()) })
        .where(
          and(
            eq(s.invitations.id, values.invitationId),
            eq(s.invitations.organizationId, values.organizationId),
            isNull(s.invitations.acceptedAt),
            isNull(s.invitations.revokedAt),
          ),
        )
        .returning({ id: s.invitations.id });
      if (revoked.length)
        await tx.insert(s.changeEvents).values({
          organizationId: values.organizationId,
          actorId: principal.userId,
          type: "invitation.revoked",
          entityId: values.invitationId,
        });
      return { ok: true };
    });
  }

  async accept(
    principal: Principal,
    input: z.infer<typeof acceptInviteSchema>,
  ) {
    const { token } = acceptInviteSchema.parse(input);
    if (
      principal.source === "mcp" ||
      principal.readOnly ||
      principal.organizationId ||
      principal.productIds
    )
      throw new DomainError("FORBIDDEN", 403);
    return this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ organizationId: s.invitations.organizationId })
        .from(s.invitations)
        .where(eq(s.invitations.tokenHash, tokenHash(token)));
      if (!target) throw new DomainError("INVITE_UNAVAILABLE", 404);
      await lockOrganization(tx, target.organizationId);
      const [invitation] = await tx
        .select()
        .from(s.invitations)
        .where(eq(s.invitations.tokenHash, tokenHash(token)))
        .for("update");
      if (!invitation) throw new DomainError("INVITE_UNAVAILABLE", 404);
      const [account] = await tx
        .select()
        .from(s.user)
        .where(eq(s.user.id, principal.userId));
      if (
        !account?.emailVerified ||
        account.email.toLowerCase() !== invitation.email
      )
        throw new DomainError("INVITE_EMAIL_MISMATCH", 403);
      if (
        invitation.revokedAt ||
        invitation.expiresAt.getTime() <= this.clock()
      )
        throw new DomainError("INVITE_UNAVAILABLE", 409);
      const [existing] = await tx
        .select()
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.organizationId, invitation.organizationId),
            eq(s.memberships.userId, principal.userId),
          ),
        );
      if (invitation.acceptedAt && !existing?.active)
        throw new DomainError("INVITE_UNAVAILABLE", 409);
      if (!existing?.active) {
        const products = await administrator(
          tx,
          { userId: invitation.inviterId, source: "session" },
          invitation.organizationId,
        );
        validateProducts(products, invitation.productIds);
        await tx
          .insert(s.memberships)
          .values({
            organizationId: invitation.organizationId,
            userId: principal.userId,
            role: invitation.role,
          })
          .onConflictDoUpdate({
            target: [s.memberships.organizationId, s.memberships.userId],
            set: { active: true, role: invitation.role },
          });
        await tx
          .delete(s.productMemberships)
          .where(
            and(
              eq(
                s.productMemberships.organizationId,
                invitation.organizationId,
              ),
              eq(s.productMemberships.userId, principal.userId),
            ),
          );
        if (invitation.role === "member")
          await tx.insert(s.productMemberships).values(
            invitation.productIds.map((productId) => ({
              organizationId: invitation.organizationId,
              userId: principal.userId,
              productId,
            })),
          );
      }
      await tx
        .update(s.invitations)
        .set({ acceptedAt: new Date(this.clock()) })
        .where(eq(s.invitations.id, invitation.id));
      if (!invitation.acceptedAt)
        await tx.insert(s.changeEvents).values({
          organizationId: invitation.organizationId,
          actorId: principal.userId,
          type: "invitation.accepted",
          entityId: invitation.id,
        });
      return { organizationId: invitation.organizationId };
    });
  }

  async updateMember(
    principal: Principal,
    input: z.infer<typeof memberAccessSchema>,
  ) {
    const values = memberAccessSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, values.organizationId);
      validateProducts(
        await administrator(tx, principal, values.organizationId),
        values.productIds,
      );
      const members = await tx
        .select()
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.organizationId, values.organizationId),
            eq(s.memberships.active, true),
          ),
        );
      const member = members.find((entry) => entry.userId === values.userId);
      if (!member) throw new DomainError("NOT_FOUND", 404);
      if (
        member.role === "admin" &&
        values.role !== "admin" &&
        members.filter((entry) => entry.role === "admin").length === 1
      )
        throw new DomainError("LAST_ADMIN", 409);
      await tx
        .update(s.memberships)
        .set({ role: values.role })
        .where(eq(s.memberships.id, member.id));
      await tx
        .delete(s.productMemberships)
        .where(
          and(
            eq(s.productMemberships.organizationId, values.organizationId),
            eq(s.productMemberships.userId, values.userId),
          ),
        );
      if (values.role === "member")
        await tx.insert(s.productMemberships).values(
          values.productIds.map((productId) => ({
            organizationId: values.organizationId,
            userId: values.userId,
            productId,
          })),
        );
      await tx.insert(s.changeEvents).values({
        organizationId: values.organizationId,
        actorId: principal.userId,
        type: "member.access-changed",
        entityId: member.id,
      });
      return { ok: true };
    });
  }

  async updateOrganization(
    principal: Principal,
    input: z.infer<typeof organizationSettingsSchema>,
  ) {
    const values = organizationSettingsSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, values.organizationId);
      await administrator(tx, principal, values.organizationId);
      const [organization] = await tx
        .update(s.organizations)
        .set({ name: values.name, timezone: values.timezone })
        .where(eq(s.organizations.id, values.organizationId))
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: values.organizationId,
        actorId: principal.userId,
        type: "organization.updated",
        entityId: values.organizationId,
      });
      return organization;
    });
  }

  async removeMember(
    principal: Principal,
    input: z.infer<typeof removeMemberSchema>,
  ) {
    const values = removeMemberSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, values.organizationId);
      await administrator(tx, principal, values.organizationId);
      const members = await tx
        .select()
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.organizationId, values.organizationId),
            eq(s.memberships.active, true),
          ),
        );
      const member = members.find((entry) => entry.userId === values.userId);
      if (!member) return { ok: true };
      if (
        member.role === "admin" &&
        members.filter((entry) => entry.role === "admin").length === 1
      )
        throw new DomainError("LAST_ADMIN", 409);
      await tx
        .update(s.memberships)
        .set({ active: false })
        .where(eq(s.memberships.id, member.id));
      await tx.insert(s.changeEvents).values({
        organizationId: values.organizationId,
        actorId: principal.userId,
        type: "member.removed",
        entityId: member.id,
      });
      return { ok: true };
    });
  }
}
