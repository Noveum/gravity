import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { sendInvitationEmail } from "../auth/email";
import { appUrl } from "../auth/options";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { emailDomainAllowed } from "./email-domains";
import { deactivateMember, lockedMemberships } from "./members";
import {
  authorizeAdministrator,
  DomainError,
  type Principal,
  uniqueViolation,
} from "./policy";
import { lockOrganization } from "./visibility";
import {
  allowedEmailDomainsSchema,
  ianaTimeZoneSchema,
  workspaceSlugSchema,
} from "./workspace";

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
  reassignToUserId: z.string().trim().min(1).max(200).optional(),
});
export const memberAccessSchema = organizationScope
  .extend({
    userId: z.string().min(1).max(200),
    ...access,
  })
  .refine((input) => input.role === "admin" || input.productIds.length > 0);
export const organizationSettingsSchema = organizationScope
  .extend({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: ianaTimeZoneSchema.optional(),
    slug: workspaceSlugSchema.optional(),
    allowedEmailDomains: allowedEmailDomainsSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.timezone !== undefined ||
      value.slug !== undefined ||
      value.allowedEmailDomains !== undefined,
  );

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const acceptUrl = (token: string) => `${appUrl()}/invite#${token}`;

async function administrator(
  db: Database,
  principal: Principal,
  organizationId: string,
  write = true,
) {
  const { products } = await authorizeAdministrator(
    db,
    principal,
    organizationId,
    write,
  );
  return products;
}

async function organizationRow(db: Database, organizationId: string) {
  const [organization] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId));
  if (!organization) throw new DomainError("NOT_FOUND", 404);
  return organization;
}

function assertDomain(
  email: string,
  organization: typeof s.organizations.$inferSelect,
) {
  if (!emailDomainAllowed(email, organization.allowedEmailDomains))
    throw new DomainError("EMAIL_DOMAIN_NOT_ALLOWED", 403);
}

function validateProducts(products: { id: string }[], ids: string[]) {
  if (ids.some((id) => !products.some((product) => product.id === id)))
    throw new DomainError("FORBIDDEN", 403);
}

async function invitationProducts(
  db: Database,
  invitation: {
    organizationId: string;
    inviterId: string;
    productIds: string[];
  },
) {
  try {
    const products = await administrator(
      db,
      { userId: invitation.inviterId, source: "session" },
      invitation.organizationId,
      false,
    );
    validateProducts(products, invitation.productIds);
    return products;
  } catch (error) {
    if (error instanceof DomainError && error.code === "FORBIDDEN")
      throw new DomainError("INVITE_UNAVAILABLE", 409);
    throw error;
  }
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
    if (!invitation) throw new DomainError("INVITE_UNAVAILABLE", 409);
    const [account] = await this.db
      .select()
      .from(s.user)
      .where(eq(s.user.id, principal.userId));
    if (
      !account?.emailVerified ||
      account.email.toLowerCase() !== invitation.email
    )
      throw new DomainError("INVITE_EMAIL_MISMATCH", 403);
    const organization = await organizationRow(
      this.db,
      invitation.organizationId,
    );
    const [member] = await this.db
      .select({ active: s.memberships.active })
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.organizationId, invitation.organizationId),
          eq(s.memberships.userId, principal.userId),
        ),
      );
    if (member?.active)
      return {
        organizationId: organization.id,
        organizationName: organization.name,
        email: invitation.email,
        role: invitation.role,
        products: [],
        alreadyMember: true,
      };
    if (
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= this.clock()
    )
      throw new DomainError("INVITE_UNAVAILABLE", 409);
    assertDomain(invitation.email, organization);
    const products = (await invitationProducts(this.db, invitation)).filter(
      (product) => !product.archivedAt,
    );
    const granted = products.filter(
      (product) =>
        invitation.role === "admin" ||
        invitation.productIds.includes(product.id),
    );
    if (invitation.role === "member" && !granted.length)
      throw new DomainError("INVITE_UNAVAILABLE", 409);
    return {
      organizationId: organization.id,
      organizationName: organization.name,
      email: invitation.email,
      role: invitation.role,
      products: granted.map((product) => product.name),
      alreadyMember: false,
    };
  }

  async invite(principal: Principal, input: z.infer<typeof inviteSchema>) {
    const values = inviteSchema.parse(input);
    const token = randomBytes(32).toString("hex");
    const created = await this.db
      .transaction(async (tx) => {
        await lockOrganization(tx, values.organizationId);
        const products = await administrator(
          tx,
          principal,
          values.organizationId,
        );
        if (principal.source === "mcp")
          throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
        validateProducts(products, values.productIds);
        if (
          products.some(
            (product) =>
              product.archivedAt && values.productIds.includes(product.id),
          )
        )
          throw new DomainError("PRODUCT_ARCHIVED", 409);
        const organization = await organizationRow(tx, values.organizationId);
        assertDomain(values.email, organization);
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
        return { ...invitation, workspace: organization.name };
      })
      .catch((error: unknown) => {
        if (uniqueViolation(error)) throw new DomainError("CONFLICT", 409);
        throw error;
      });
    const link = acceptUrl(token);
    const emailStatus = await sendInvitationEmail({
      id: created.id,
      email: values.email,
      workspace: created.workspace,
      link,
      expiresAt: created.expiresAt,
    });
    return {
      id: created.id,
      expiresAt: created.expiresAt,
      acceptUrl: link,
      emailStatus,
    };
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
        assertDomain(
          invitation.email,
          await organizationRow(tx, invitation.organizationId),
        );
        await invitationProducts(tx, invitation);
        const granted =
          invitation.role === "member"
            ? await tx
                .select({ id: s.products.id })
                .from(s.products)
                .where(
                  and(
                    eq(s.products.organizationId, invitation.organizationId),
                    inArray(s.products.id, invitation.productIds),
                    isNull(s.products.archivedAt),
                  ),
                )
                .for("share")
            : [];
        if (invitation.role === "member" && !granted.length)
          throw new DomainError("INVITE_UNAVAILABLE", 409);
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
        if (granted.length)
          await tx.insert(s.productMemberships).values(
            granted.map((product) => ({
              organizationId: invitation.organizationId,
              userId: principal.userId,
              productId: product.id,
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
      if (principal.source === "mcp" && member.role !== "admin") {
        const current = new Set(
          (
            await tx
              .select({ productId: s.productMemberships.productId })
              .from(s.productMemberships)
              .where(
                and(
                  eq(
                    s.productMemberships.organizationId,
                    values.organizationId,
                  ),
                  eq(s.productMemberships.userId, member.userId),
                ),
              )
          ).map((row) => row.productId),
        );
        if (
          values.role === "admin" ||
          values.productIds.some((productId) => !current.has(productId))
        )
          throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
      }
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
    return this.db
      .transaction(async (tx) => {
        await lockOrganization(tx, values.organizationId);
        await administrator(tx, principal, values.organizationId);
        const current = await organizationRow(tx, values.organizationId);
        if (
          principal.source === "mcp" &&
          values.timezone !== undefined &&
          values.timezone !== current.timezone
        )
          throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
        if (values.slug !== undefined) {
          const [taken] = await tx
            .select({ id: s.organizations.id })
            .from(s.organizations)
            .where(
              and(
                eq(s.organizations.slug, values.slug),
                ne(s.organizations.id, values.organizationId),
              ),
            );
          if (taken) throw new DomainError("SLUG_TAKEN", 409);
        }
        const [organization] = await tx
          .update(s.organizations)
          .set({
            ...(values.name !== undefined ? { name: values.name } : {}),
            ...(values.timezone !== undefined
              ? { timezone: values.timezone }
              : {}),
            ...(values.slug !== undefined ? { slug: values.slug } : {}),
            ...(values.allowedEmailDomains !== undefined
              ? { allowedEmailDomains: values.allowedEmailDomains }
              : {}),
          })
          .where(eq(s.organizations.id, values.organizationId))
          .returning();
        await tx.insert(s.changeEvents).values({
          organizationId: values.organizationId,
          actorId: principal.userId,
          type: "organization.updated",
          entityId: values.organizationId,
        });
        return organization;
      })
      .catch((error: unknown) => {
        if (uniqueViolation(error)) throw new DomainError("SLUG_TAKEN", 409);
        throw error;
      });
  }

  async removeMember(
    principal: Principal,
    input: z.infer<typeof removeMemberSchema>,
  ) {
    const values = removeMemberSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const rows = await lockedMemberships(tx, values.organizationId);
      await administrator(tx, principal, values.organizationId);
      return deactivateMember(
        tx,
        principal.userId,
        rows,
        values,
        new Date(this.clock()),
      );
    });
  }
}
