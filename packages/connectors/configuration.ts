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
import {
  unipileDsn,
  unipileV1Account,
  unipileV1Json,
  unipileV1Status,
} from "./unipile-v1";

export const unipileSettingsInput = z
  .object({
    organizationId: z.uuid(),
    configurationId: z.uuid().optional(),
    apiKey: z.string().trim().min(10).max(2000).optional(),
    signingSecret: z.string().trim().min(16).max(2000).optional(),
    apiVersion: z.enum(["v1", "v2"]).optional(),
    dsn: unipileDsn.optional(),
  })
  .refine((value) => value.apiKey || value.signingSecret);
interface UnipileCredentials {
  apiKey: string;
  signingSecret?: string;
  apiVersion?: "v1" | "v2";
  dsn?: string;
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
  const credentials = unipileCredentials(row);
  return {
    id: row.id,
    webhookReady: row.webhookReady,
    webhookUrl: `${appUrl()}/api/webhooks/unipile?configurationId=${row.id}`,
    apiVersion: credentials.apiVersion ?? "v2",
    ...(credentials.dsn ? { dsn: credentials.dsn } : {}),
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
    const priorCredentials = prior ? unipileCredentials(prior) : undefined;
    const apiVersion = value.apiVersion ?? priorCredentials?.apiVersion ?? "v2";
    const dsn = value.dsn ?? priorCredentials?.dsn;
    if (apiVersion === "v1" && !dsn)
      throw new DomainError("UNIPILE_DSN_REQUIRED", 422);
    if (apiVersion === "v2" && value.dsn)
      throw new DomainError("INVALID_INPUT", 400);
    if (!value.apiKey && (value.apiVersion || value.dsn))
      throw new DomainError("INVALID_INPUT", 400);
    if (value.apiKey) {
      try {
        if (apiVersion === "v1")
          z.object({ items: z.array(z.unknown()) }).parse(
            await unipileV1Json(
              { apiKey: value.apiKey, dsn },
              "/accounts?limit=1",
              {},
              this.transport,
            ),
          );
        else
          z.object({ data: z.array(z.unknown()) }).parse(
            await unipileJson(
              value.apiKey,
              "/accounts?limit=1",
              {},
              this.transport,
            ),
          );
      } catch (error) {
        if ((error as { providerStatus?: number }).providerStatus === 401)
          throw new DomainError("UNIPILE_KEY_INVALID", 422);
        if ((error as { providerStatus?: number }).providerStatus === 400)
          throw new DomainError("UNIPILE_REQUEST_INVALID", 422);
        throw error;
      }
    }
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
        if (connected && (value.apiKey || apiVersion !== "v1"))
          throw new DomainError("PROVIDER_CONFIGURATION_IN_USE", 409);
      }
      const id = current?.id ?? randomUUID();
      const credentials = {
        ...(current && !value.apiKey ? unipileCredentials(current) : {}),
        ...(value.apiKey ? { apiKey: value.apiKey } : {}),
        ...(value.signingSecret ? { signingSecret: value.signingSecret } : {}),
        apiVersion,
        ...(apiVersion === "v1" ? { dsn } : {}),
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
  async accounts(
    principal: Principal,
    organizationId: string,
    cursor?: string,
  ) {
    const configuration = await this.own(principal, organizationId);
    if (!configuration) throw new DomainError("UNIPILE_SETUP_REQUIRED", 422);
    const credentials = unipileCredentials(configuration);
    if (credentials.apiVersion !== "v1")
      throw new DomainError("INVALID_INPUT", 400);
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", z.string().min(1).max(2000).parse(cursor));
    const result = z
      .object({ items: z.array(z.unknown()), cursor: z.string().nullish() })
      .parse(
        await unipileV1Json(
          credentials,
          `/accounts?${query}`,
          {},
          this.transport,
        ),
      );
    const accounts = result.items.flatMap((item) => {
      const value = unipileV1Account.safeParse(item);
      if (!value.success) return [];
      return [
        {
          id: value.data.id,
          name: value.data.name,
          status: unipileV1Status(value.data),
        },
      ];
    });
    return { accounts, nextCursor: result.cursor ?? null };
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
