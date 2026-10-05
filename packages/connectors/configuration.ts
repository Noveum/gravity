import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { appUrl } from "../auth/options";
import { publishChange } from "../core/changes";
import { authorize, DomainError, type Principal } from "../core/policy";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { type ProviderFetch, unipileJson } from "./providers";
import { encryptionConfigured, seal, unseal } from "./security";

export const unipileSettingsInput = z
  .object({
    organizationId: z.uuid(),
    configurationId: z.uuid().optional(),
    apiKey: z.string().trim().min(10).max(2000).optional(),
    signingSecret: z.string().trim().min(16).max(2000).optional(),
  })
  .refine((value) => value.apiKey || value.signingSecret);
interface UnipileCredentials {
  apiKey: string;
  signingSecret?: string;
}
type Configuration = typeof s.providerConfigurations.$inferSelect;
const context = (
  row: Pick<Configuration, "id" | "organizationId" | "ownerId">,
) => `${row.organizationId}:${row.ownerId}:${row.id}:provider`;
export function unipileCredentials(row: Configuration): UnipileCredentials {
  if (!row.active || !row.encryptedCredentials)
    throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
  return unseal<UnipileCredentials>(row.encryptedCredentials, context(row));
}
export function publicUnipileConfiguration(row: Configuration) {
  return {
    id: row.id,
    webhookReady: row.webhookReady,
    webhookUrl: `${appUrl()}/api/webhooks/unipile?configurationId=${row.id}`,
  };
}
export class ProviderConfigurationService {
  constructor(
    private db: Database,
    private transport: ProviderFetch = fetch,
  ) {}
  async own(principal: Principal, organizationId: string) {
    if (
      principal.source !== "session" &&
      !(principal.source === "mcp" && principal.organizationId)
    )
      throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
    await authorize(this.db, principal, organizationId);
    const [row] = await this.db
      .select()
      .from(s.providerConfigurations)
      .where(
        and(
          eq(s.providerConfigurations.organizationId, organizationId),
          eq(s.providerConfigurations.ownerId, principal.userId),
          eq(s.providerConfigurations.provider, "unipile"),
          eq(s.providerConfigurations.active, true),
        ),
      );
    return row ?? null;
  }
  async configure(
    principal: Principal,
    input: z.infer<typeof unipileSettingsInput>,
  ) {
    if (principal.source === "mcp" && principal.productIds !== undefined)
      throw new DomainError("FORBIDDEN", 403);
    const value = unipileSettingsInput.parse(input);
    const prior = await this.own(principal, value.organizationId);
    await authorize(this.db, principal, value.organizationId, undefined, true);
    if (!encryptionConfigured())
      throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    if (prior?.id !== value.configurationId)
      throw new DomainError("STALE_CONFIGURATION", 409);
    if (!prior && !value.apiKey) throw new DomainError("INVALID_INPUT", 400);
    // Verify through the fixed provider origin; no account contents or credentials are returned.
    if (value.apiKey)
      z.object({ data: z.array(z.unknown()) }).parse(
        await unipileJson(
          value.apiKey,
          "/accounts?limit=1",
          {},
          this.transport,
        ),
      );
    const result = await this.db.transaction(async (tx) => {
      await authorize(tx, principal, value.organizationId, undefined, true);
      await tx
        .select()
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.organizationId, value.organizationId),
            eq(s.memberships.userId, principal.userId),
          ),
        )
        .for("update");
      const [current] = await tx
        .select()
        .from(s.providerConfigurations)
        .where(
          and(
            eq(s.providerConfigurations.organizationId, value.organizationId),
            eq(s.providerConfigurations.ownerId, principal.userId),
            eq(s.providerConfigurations.active, true),
          ),
        )
        .for("update");
      if (current?.id !== prior?.id || current?.version !== prior?.version)
        throw new DomainError("STALE_CONFIGURATION", 409);
      if (current) {
        const [connected] = await tx
          .select({ id: s.connections.id })
          .from(s.connections)
          .where(eq(s.connections.providerConfigurationId, current.id))
          .limit(1);
        // A different API application can reuse account IDs. Replace the setup explicitly instead.
        if (connected)
          throw new DomainError("PROVIDER_CONFIGURATION_IN_USE", 409);
      }
      const id = current?.id ?? randomUUID();
      const credentials = {
        ...(current && !value.apiKey ? unipileCredentials(current) : {}),
        ...(value.apiKey ? { apiKey: value.apiKey } : {}),
        ...(value.signingSecret ? { signingSecret: value.signingSecret } : {}),
      };
      const rowContext = {
        id,
        organizationId: value.organizationId,
        ownerId: principal.userId,
      };
      const values = {
        ...rowContext,
        provider: "unipile" as const,
        encryptedCredentials: seal(credentials, context(rowContext)),
        webhookReady: !!credentials.signingSecret,
        version: (current?.version ?? 0) + 1,
      };
      const [saved] = current
        ? await tx
            .update(s.providerConfigurations)
            .set(values)
            .where(eq(s.providerConfigurations.id, id))
            .returning()
        : await tx.insert(s.providerConfigurations).values(values).returning();
      await tx
        .update(s.integrationFlows)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(s.integrationFlows.organizationId, value.organizationId),
            eq(s.integrationFlows.ownerId, principal.userId),
            eq(s.integrationFlows.provider, "linkedin"),
            isNull(s.integrationFlows.consumedAt),
          ),
        );
      await tx.insert(s.changeEvents).values({
        organizationId: value.organizationId,
        actorId: principal.userId,
        type: "provider.configured",
        entityId: id,
      });
      return publicUnipileConfiguration(saved);
    });
    publishChange(value.organizationId);
    return result;
  }
  async remove(
    principal: Principal,
    organizationId: string,
    configurationId: string,
  ) {
    if (principal.source === "mcp" && principal.productIds !== undefined)
      throw new DomainError("FORBIDDEN", 403);
    const prior = await this.own(principal, organizationId);
    if (prior?.id !== configurationId) throw new DomainError("NOT_FOUND", 404);
    await this.db.transaction(async (tx) => {
      await authorize(tx, principal, organizationId, undefined, true);
      const [current] = await tx
        .select()
        .from(s.providerConfigurations)
        .where(eq(s.providerConfigurations.id, prior.id))
        .for("update");
      if (!current?.active) throw new DomainError("NOT_FOUND", 404);
      await tx
        .update(s.providerConfigurations)
        .set({
          active: false,
          encryptedCredentials: null,
          webhookReady: false,
          version: current.version + 1,
        })
        .where(eq(s.providerConfigurations.id, current.id));
      await tx
        .update(s.integrationFlows)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(s.integrationFlows.organizationId, organizationId),
            eq(s.integrationFlows.ownerId, principal.userId),
            eq(s.integrationFlows.provider, "linkedin"),
            isNull(s.integrationFlows.consumedAt),
          ),
        );
      await tx
        .update(s.connections)
        .set({
          status: "disconnected",
          encryptedCredentials: null,
          webhookSecret: null,
          leaseId: null,
          leaseUntil: null,
          errorCode: null,
        })
        .where(eq(s.connections.providerConfigurationId, current.id));
      await tx.insert(s.changeEvents).values({
        organizationId,
        actorId: principal.userId,
        type: "provider.removed",
        entityId: current.id,
      });
    });
    publishChange(organizationId);
    return { ok: true };
  }
}
