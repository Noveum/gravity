import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { sendInvitationEmail } from "../auth/email";
import { appUrl } from "../auth/options";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { emailDomainAllowed } from "./email-domains";
import { authorizeAdministrator, DomainError, type Principal } from "./policy";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;
type Invitation = typeof s.invitations.$inferSelect;

const day = 86400000;
const invitationScope = z.object({
  organizationId: z.uuid(),
  invitationId: z.uuid(),
});
export const createInvitationSchema = z.object({
  organizationId: z.uuid(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(["admin", "member"]).default("member"),
  productIds: z
    .array(z.uuid())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length)
    .default([]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export const resendInvitationSchema = invitationScope.extend({
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export const revokeInvitationSchema = invitationScope;
export const listInvitationsSchema = z.object({ organizationId: z.uuid() });
export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const newToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
};
function status(invitation: Invitation, now = Date.now()) {
  if (invitation.revokedAt) return "revoked" as const;
  if (invitation.acceptedAt) return "accepted" as const;
  if (invitation.expiresAt.getTime() <= now) return "expired" as const;
  return "pending" as const;
}
function view(invitation: Invitation) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    productIds: invitation.productIds,
    status: status(invitation),
    expiresAt: invitation.expiresAt.toISOString(),
    invitedBy: invitation.invitedBy,
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    acceptedBy: invitation.acceptedBy,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
  };
}
function assertUsable(invitation: Invitation) {
  const current = status(invitation);
  if (current === "revoked") throw new DomainError("INVITATION_REVOKED", 410);
  if (current === "accepted") throw new DomainError("INVITATION_USED", 409);
  if (current === "expired") throw new DomainError("INVITATION_EXPIRED", 410);
}
function uniqueViolation(error: unknown) {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (
    (error as { code?: string }).code === "23505" || cause?.code === "23505"
  );
}
async function workspace(db: Reader, organizationId: string) {
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
const acceptUrl = (token: string) =>
  `${appUrl()}/invite/${encodeURIComponent(token)}`;

export class InvitationService {
  constructor(private db: Database) {}

  private async deliver(
    invitation: Invitation,
    organizationName: string,
    link: string,
  ) {
    const emailStatus = await sendInvitationEmail({
      id: invitation.id,
      email: invitation.email,
      workspace: organizationName,
      link,
      expiresAt: invitation.expiresAt,
    });
    return { invitation: view(invitation), acceptUrl: link, emailStatus };
  }

  async create(
    principal: Principal,
    input: z.input<typeof createInvitationSchema>,
  ) {
    const values = createInvitationSchema.parse(input);
    const { token, tokenHash } = newToken();
    const link = acceptUrl(token);
    const { invitation, organization } = await this.db
      .transaction(async (tx) => {
        await authorizeAdministrator(tx, principal, values.organizationId);
        if (principal.source === "mcp")
          throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
        const organization = await workspace(tx, values.organizationId);
        assertDomain(values.email, organization);
        const products = values.productIds.length
          ? await tx
              .select({ id: s.products.id })
              .from(s.products)
              .where(
                and(
                  eq(s.products.organizationId, values.organizationId),
                  inArray(s.products.id, values.productIds),
                ),
              )
          : [];
        if (products.length !== values.productIds.length)
          throw new DomainError("NOT_FOUND", 404);
        const [member] = await tx
          .select({ id: s.memberships.id })
          .from(s.memberships)
          .innerJoin(s.user, eq(s.user.id, s.memberships.userId))
          .where(
            and(
              eq(s.memberships.organizationId, values.organizationId),
              eq(s.memberships.active, true),
              eq(sql`lower(${s.user.email})`, values.email),
            ),
          );
        if (member) throw new DomainError("ALREADY_MEMBER", 409);
        const [open] = await tx
          .select()
          .from(s.invitations)
          .where(
            and(
              eq(s.invitations.organizationId, values.organizationId),
              eq(s.invitations.email, values.email),
              isNull(s.invitations.acceptedAt),
              isNull(s.invitations.revokedAt),
            ),
          )
          .for("update");
        if (open && status(open) === "pending")
          throw new DomainError("INVITATION_PENDING", 409);
        if (open)
          await tx
            .update(s.invitations)
            .set({ revokedAt: new Date() })
            .where(eq(s.invitations.id, open.id));
        const [invitation] = await tx
          .insert(s.invitations)
          .values({
            organizationId: values.organizationId,
            email: values.email,
            role: values.role,
            productIds: values.productIds,
            tokenHash,
            expiresAt: new Date(Date.now() + values.expiresInDays * day),
            invitedBy: principal.userId,
          })
          .returning();
        await tx.insert(s.changeEvents).values({
          organizationId: values.organizationId,
          actorId: principal.userId,
          type: "invitation.created",
          entityId: invitation.id,
        });
        return { invitation, organization };
      })
      .catch((error: unknown) => {
        if (uniqueViolation(error))
          throw new DomainError("INVITATION_PENDING", 409);
        throw error;
      });
    return this.deliver(invitation, organization.name, link);
  }

  async resend(
    principal: Principal,
    input: z.input<typeof resendInvitationSchema>,
  ) {
    const values = resendInvitationSchema.parse(input);
    const { token, tokenHash } = newToken();
    const link = acceptUrl(token);
    const { invitation, organization } = await this.db.transaction(
      async (tx) => {
        await authorizeAdministrator(tx, principal, values.organizationId);
        if (principal.source === "mcp")
          throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
        const organization = await workspace(tx, values.organizationId);
        const current = await this.locked(tx, values);
        if (current.revokedAt) throw new DomainError("INVITATION_REVOKED", 410);
        if (current.acceptedAt) throw new DomainError("INVITATION_USED", 409);
        assertDomain(current.email, organization);
        const [invitation] = await tx
          .update(s.invitations)
          .set({
            tokenHash,
            expiresAt: new Date(Date.now() + values.expiresInDays * day),
          })
          .where(eq(s.invitations.id, current.id))
          .returning();
        await tx.insert(s.changeEvents).values({
          organizationId: values.organizationId,
          actorId: principal.userId,
          type: "invitation.resent",
          entityId: current.id,
        });
        return { invitation, organization };
      },
    );
    return this.deliver(invitation, organization.name, link);
  }

  async revoke(
    principal: Principal,
    input: z.infer<typeof revokeInvitationSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeAdministrator(tx, principal, input.organizationId);
      const current = await this.locked(tx, input);
      if (current.revokedAt) throw new DomainError("INVITATION_REVOKED", 410);
      if (current.acceptedAt) throw new DomainError("INVITATION_USED", 409);
      const [invitation] = await tx
        .update(s.invitations)
        .set({ revokedAt: new Date() })
        .where(eq(s.invitations.id, current.id))
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        actorId: principal.userId,
        type: "invitation.revoked",
        entityId: current.id,
      });
      return { invitation: view(invitation) };
    });
  }

  async list(principal: Principal, organizationId: string) {
    await authorizeAdministrator(this.db, principal, organizationId);
    const rows = await this.db
      .select()
      .from(s.invitations)
      .where(eq(s.invitations.organizationId, organizationId))
      .orderBy(desc(s.invitations.createdAt));
    return { invitations: rows.map(view) };
  }

  async preview(principal: Principal, token: string) {
    const { invitation, organization } = await this.inspect(
      this.db,
      principal,
      token,
    );
    return {
      organizationId: organization.id,
      organizationName: organization.name,
      role: invitation.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async accept(
    principal: Principal,
    input: z.infer<typeof acceptInvitationSchema>,
  ) {
    if (principal.source === "mcp" || principal.readOnly)
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    return this.db.transaction(async (tx) => {
      const { invitation, organization } = await this.inspect(
        tx,
        principal,
        input.token,
        true,
      );
      const [existing] = await tx
        .select()
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.organizationId, invitation.organizationId),
            eq(s.memberships.userId, principal.userId),
          ),
        )
        .for("update");
      if (existing?.active) throw new DomainError("ALREADY_MEMBER", 409);
      const [membership] = existing
        ? await tx
            .update(s.memberships)
            .set({ active: true, role: invitation.role })
            .where(eq(s.memberships.id, existing.id))
            .returning()
        : await tx
            .insert(s.memberships)
            .values({
              organizationId: invitation.organizationId,
              userId: principal.userId,
              role: invitation.role,
            })
            .returning();
      const products = invitation.productIds.length
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
      await tx
        .delete(s.productMemberships)
        .where(
          and(
            eq(s.productMemberships.organizationId, invitation.organizationId),
            eq(s.productMemberships.userId, principal.userId),
          ),
        );
      if (products.length)
        await tx.insert(s.productMemberships).values(
          products.map((product) => ({
            organizationId: invitation.organizationId,
            productId: product.id,
            userId: principal.userId,
          })),
        );
      await tx
        .update(s.invitations)
        .set({ acceptedAt: new Date(), acceptedBy: principal.userId })
        .where(eq(s.invitations.id, invitation.id));
      await tx.insert(s.changeEvents).values([
        {
          organizationId: invitation.organizationId,
          actorId: principal.userId,
          type: "invitation.accepted",
          entityId: invitation.id,
        },
        {
          organizationId: invitation.organizationId,
          actorId: principal.userId,
          type: "member.joined",
          entityId: membership.id,
        },
      ]);
      return {
        organizationId: organization.id,
        organizationName: organization.name,
        role: membership.role,
        productIds: products.map((product) => product.id).sort(),
      };
    });
  }

  private async locked(db: Reader, input: z.infer<typeof invitationScope>) {
    const [invitation] = await db
      .select()
      .from(s.invitations)
      .where(
        and(
          eq(s.invitations.id, input.invitationId),
          eq(s.invitations.organizationId, input.organizationId),
        ),
      )
      .for("update");
    if (!invitation) throw new DomainError("NOT_FOUND", 404);
    return invitation;
  }

  private async inspect(
    db: Reader,
    principal: Principal,
    token: string,
    lock = false,
  ) {
    const query = db
      .select()
      .from(s.invitations)
      .where(eq(s.invitations.tokenHash, hashToken(token)));
    const [invitation] = lock ? await query.for("update") : await query;
    if (!invitation) throw new DomainError("NOT_FOUND", 404);
    assertUsable(invitation);
    const [account] = await db
      .select()
      .from(s.user)
      .where(eq(s.user.id, principal.userId));
    if (!account) throw new DomainError("UNAUTHORIZED", 401);
    if (account.email.trim().toLowerCase() !== invitation.email)
      throw new DomainError("INVITATION_EMAIL_MISMATCH", 403);
    if (!account.emailVerified)
      throw new DomainError("EMAIL_NOT_VERIFIED", 403);
    const organization = await workspace(db, invitation.organizationId);
    assertDomain(invitation.email, organization);
    return { invitation, organization };
  }
}
