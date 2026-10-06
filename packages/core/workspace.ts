import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { normalizeEmailDomains } from "./email-domains";
import {
  authorizeAdministrator,
  DomainError,
  type Principal,
  uniqueViolation,
} from "./policy";

export const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
const domainPattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const workspaceSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const updateWorkspaceSchema = z
  .object({
    organizationId: z.uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    timezone: ianaTimeZoneSchema.optional(),
    slug: workspaceSlugSchema.optional(),
    allowedEmailDomains: z
      .array(z.string().max(254))
      .max(100)
      .transform(normalizeEmailDomains)
      .refine((domains) =>
        domains.every((domain) => domainPattern.test(domain)),
      )
      .optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.timezone !== undefined ||
      value.slug !== undefined ||
      value.allowedEmailDomains !== undefined,
  );

export class WorkspaceService {
  constructor(private db: Database) {}

  async update(
    principal: Principal,
    input: z.infer<typeof updateWorkspaceSchema>,
  ) {
    return this.db
      .transaction(async (tx) => {
        await authorizeAdministrator(tx, principal, input.organizationId);
        if (input.slug !== undefined) {
          const [taken] = await tx
            .select({ id: s.organizations.id })
            .from(s.organizations)
            .where(
              and(
                eq(s.organizations.slug, input.slug),
                ne(s.organizations.id, input.organizationId),
              ),
            );
          if (taken) throw new DomainError("SLUG_TAKEN", 409);
        }
        const [organization] = await tx
          .update(s.organizations)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.timezone !== undefined
              ? { timezone: input.timezone }
              : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.allowedEmailDomains !== undefined
              ? { allowedEmailDomains: input.allowedEmailDomains }
              : {}),
          })
          .where(eq(s.organizations.id, input.organizationId))
          .returning();
        if (!organization) throw new DomainError("NOT_FOUND", 404);
        await tx.insert(s.changeEvents).values({
          organizationId: input.organizationId,
          actorId: principal.userId,
          type: "workspace.updated",
          entityId: input.organizationId,
        });
        return organization;
      })
      .catch((error: unknown) => {
        if (uniqueViolation(error)) throw new DomainError("SLUG_TAKEN", 409);
        throw error;
      });
  }
}
