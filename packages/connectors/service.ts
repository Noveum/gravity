import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { appUrl } from "../auth/options";
import { publishChange } from "../core/changes";
import { pauseForReply, peopleByEmail } from "../core/outreach";
import { authorize, DomainError, type Principal } from "../core/policy";
import { assertActiveRelationships } from "../core/visibility";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import {
  ProviderConfigurationService,
  publicUnipileConfiguration,
  unipileCredentials,
} from "./configuration";
import { gmailSendScope } from "./outbound-provider";
import {
  exchangeGoogle,
  firefliesIdentity,
  googleConfig,
  googleScopes,
  hostedLinkedIn,
  type ProviderFetch,
  readProviderPage,
  refreshGoogle,
} from "./providers";
import { ingestReply } from "./replies";
import { encryptionConfigured, seal, stateHash, unseal } from "./security";
import {
  type ImportRecord,
  type IntegrationProvider,
  importRecordSchema,
  integrationProvider,
  type ProviderCredentials,
} from "./types";
import { unipileV1Account, unipileV1Json, unipileV1Status } from "./unipile-v1";

export const integrationScope = z.object({
  organizationId: z.uuid(),
  productId: z.uuid().optional(),
});
export const integrationOverviewInput = integrationScope.extend({
  reviewQuery: z.string().trim().max(120).optional(),
  reviewProvider: integrationProvider.optional(),
  reviewCursor: z.string().min(1).max(1000).optional(),
});
const reviewPosition = z.object({ id: z.uuid(), createdAt: z.iso.datetime() });
const reviewPageSize = 20;
export const connectInput = integrationScope.extend({
  productId: z.uuid(),
  provider: integrationProvider,
  apiKey: z.string().min(10).max(2000).optional(),
  connectionId: z.uuid().optional(),
  accountId: z.string().min(1).max(500).optional(),
  allowSending: z.boolean().default(true),
});
const accountActor = (principal: Principal) => {
  if (principal.source === "session") return;
  if (principal.source !== "mcp" || !principal.organizationId)
    throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
};
const human = (principal: Principal) => {
  if (principal.source !== "session")
    throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
};
function historicalFor(
  connection: typeof s.connections.$inferSelect,
  occurredAt: string,
) {
  return (
    typeof connection.syncCursor.connectedAt === "string" &&
    new Date(occurredAt) < new Date(connection.syncCursor.connectedAt)
  );
}
export function integrationAvailability() {
  const key = encryptionConfigured();
  return {
    gmail:
      key &&
      !!(
        process.env.GOOGLE_INTEGRATION_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
      ) &&
      !!(
        process.env.GOOGLE_INTEGRATION_CLIENT_SECRET ||
        process.env.GOOGLE_CLIENT_SECRET
      ),
    calendar:
      key &&
      !!(
        process.env.GOOGLE_INTEGRATION_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
      ) &&
      !!(
        process.env.GOOGLE_INTEGRATION_CLIENT_SECRET ||
        process.env.GOOGLE_CLIENT_SECRET
      ),
    linkedin: key,
    fireflies: key,
  };
}
const dbProvider = (
  provider: IntegrationProvider,
): (typeof s.connections.$inferSelect)["provider"] =>
  provider === "linkedin" ? "unipile" : provider;
const uiProvider = (provider: string): IntegrationProvider =>
  provider === "unipile" ? "linkedin" : integrationProvider.parse(provider);
const credentialContext = (
  connection:
    | typeof s.connections.$inferSelect
    | { id: string; organizationId: string; ownerId: string },
) => `${connection.organizationId}:${connection.ownerId}:${connection.id}`;
export function publicConnection(
  connection: typeof s.connections.$inferSelect,
) {
  return {
    id: connection.id,
    provider: uiProvider(connection.provider),
    status: connection.status,
    displayName:
      connection.displayName ||
      connection.selfEmail ||
      connection.externalAccountId,
    productId: connection.productId,
    providerConfigurationId: connection.providerConfigurationId,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    errorCode: connection.errorCode,
    more: !!connection.syncCursor.more,
    canSend:
      connection.status === "connected" &&
      (connection.provider === "unipile" ||
        (connection.provider === "gmail" &&
          connection.scopes.includes(gmailSendScope))),
  };
}
export type PublicConnection = ReturnType<typeof publicConnection>;
export interface ConnectionOverview {
  configured: ReturnType<typeof integrationAvailability>;
  unipileConfiguration: ReturnType<typeof publicUnipileConfiguration> | null;
  connections: PublicConnection[];
  items: {
    id: string;
    connectionId: string;
    productId: string;
    record: ImportRecord;
  }[];
  reviewTotal: number;
  nextReviewCursor: string | null;
}
export class IntegrationService {
  constructor(
    private db: Database,
    private transport: ProviderFetch = fetch,
  ) {}
  async overview(
    principal: Principal,
    input: z.infer<typeof integrationOverviewInput>,
  ): Promise<ConnectionOverview> {
    accountActor(principal);
    const scope = integrationOverviewInput.parse(input);
    let position: z.infer<typeof reviewPosition> | undefined;
    if (scope.reviewCursor) {
      try {
        position = reviewPosition.parse(
          JSON.parse(Buffer.from(scope.reviewCursor, "base64url").toString()),
        );
      } catch {
        throw new DomainError("INVALID_INPUT", 400);
      }
    }
    const allowed = await authorize(
      this.db,
      principal,
      scope.organizationId,
      scope.productId,
    );
    const rows = await this.db
      .select()
      .from(s.connections)
      .where(
        and(
          eq(s.connections.organizationId, scope.organizationId),
          eq(s.connections.ownerId, principal.userId),
          inArray(
            s.connections.productId,
            allowed.products.map((p) => p.id),
          ),
        ),
      );
    const search = scope.reviewQuery?.replace(/[\\%_]/g, "\\$&");
    const filter = and(
      eq(s.integrationItems.organizationId, scope.organizationId),
      inArray(
        s.integrationItems.connectionId,
        rows
          .filter(
            (r) =>
              !scope.reviewProvider ||
              uiProvider(r.provider) === scope.reviewProvider,
          )
          .map((r) => r.id),
      ),
      inArray(
        s.integrationItems.productId,
        scope.productId ? [scope.productId] : allowed.products.map((p) => p.id),
      ),
      eq(s.integrationItems.status, "unmatched"),
      search
        ? sql`(${s.integrationItems.record}->>'title' ILIKE ${`%${search}%`} OR ${s.integrationItems.record}->>'participants' ILIKE ${`%${search}%`})`
        : undefined,
    );
    const page = await this.db
      .select({
        id: s.integrationItems.id,
        connectionId: s.integrationItems.connectionId,
        productId: s.integrationItems.productId,
        record: s.integrationItems.record,
        // Preserve PostgreSQL's microseconds; a JS Date would lose rows at a page boundary.
        createdAt: sql<string>`to_char(${s.integrationItems.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(s.integrationItems)
      .where(
        and(
          filter,
          position
            ? sql`(${s.integrationItems.createdAt}, ${s.integrationItems.id}) < (${position.createdAt}::timestamptz, ${position.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(s.integrationItems.createdAt), desc(s.integrationItems.id))
      .limit(reviewPageSize + 1);
    const [total] = await this.db
      .select({ value: count() })
      .from(s.integrationItems)
      .where(filter);
    const items = page.slice(0, reviewPageSize);
    const last = items.at(-1);
    const configuration = await new ProviderConfigurationService(this.db).own(
      principal,
      scope.organizationId,
    );
    return {
      configured: {
        ...integrationAvailability(),
        linkedin:
          encryptionConfigured() &&
          !!configuration &&
          (configuration.webhookReady ||
            unipileCredentials(configuration).apiVersion === "v1"),
      },
      unipileConfiguration: configuration
        ? publicUnipileConfiguration(configuration)
        : null,
      connections: rows.map(publicConnection),
      items: items.map(({ createdAt: _createdAt, ...item }) => item),
      reviewTotal: total.value,
      nextReviewCursor:
        page.length > reviewPageSize && last
          ? Buffer.from(
              JSON.stringify({ id: last.id, createdAt: last.createdAt }),
            ).toString("base64url")
          : null,
    };
  }
  async own(
    principal: Principal,
    organizationId: string,
    id: string,
    write = true,
  ) {
    accountActor(principal);
    const [connection] = await this.db
      .select()
      .from(s.connections)
      .where(
        and(
          eq(s.connections.id, id),
          eq(s.connections.organizationId, organizationId),
          eq(s.connections.ownerId, principal.userId),
        ),
      );
    if (!connection?.productId) throw new DomainError("NOT_FOUND", 404);
    await authorize(
      this.db,
      principal,
      organizationId,
      connection.productId,
      write,
    );
    return connection;
  }
  async connect(principal: Principal, input: z.input<typeof connectInput>) {
    input = connectInput.parse(input);
    accountActor(principal);
    await authorize(
      this.db,
      principal,
      input.organizationId,
      input.productId,
      true,
    );
    if (!integrationAvailability()[input.provider])
      throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    const existing = input.connectionId
      ? await this.own(principal, input.organizationId, input.connectionId)
      : undefined;
    if (existing && uiProvider(existing.provider) !== input.provider)
      throw new DomainError("INVALID_INPUT", 400);
    if (input.provider === "fireflies") {
      if (!input.apiKey) throw new DomainError("INVALID_INPUT", 400);
      const identity = await firefliesIdentity(input.apiKey, this.transport);
      const connection = await this.saveConnected(
        principal,
        input.organizationId,
        input.productId,
        "fireflies",
        identity.user_id,
        identity.email,
        { apiKey: input.apiKey },
        [],
        existing?.id,
      );
      const context = credentialContext(connection);
      const signingSecret = connection.webhookSecret
        ? unseal<string>(connection.webhookSecret, `${context}:webhook`)
        : randomBytes(32).toString("hex");
      await this.db
        .update(s.connections)
        .set({ webhookSecret: seal(signingSecret, `${context}:webhook`) })
        .where(eq(s.connections.id, connection.id));
      return {
        connectionId: connection.id,
        webhookUrl: `${appUrl()}/api/webhooks/fireflies?connectionId=${connection.id}`,
        signingSecret,
      };
    }
    const configuration =
      input.provider === "linkedin"
        ? await new ProviderConfigurationService(this.db).own(
            principal,
            input.organizationId,
          )
        : null;
    const configurationCredentials = configuration
      ? unipileCredentials(configuration)
      : undefined;
    if (
      input.provider === "linkedin" &&
      (!configuration ||
        (!configuration.webhookReady &&
          configurationCredentials?.apiVersion !== "v1"))
    )
      throw new DomainError("UNIPILE_SETUP_REQUIRED", 422);
    if (
      existing &&
      input.provider === "linkedin" &&
      existing.providerConfigurationId !== configuration?.id
    )
      throw new DomainError("STALE_CONFIGURATION", 409);
    if (
      input.provider === "linkedin" &&
      configuration &&
      configurationCredentials?.apiVersion === "v1"
    ) {
      const accountId = existing?.externalAccountId ?? input.accountId;
      if (
        !accountId ||
        (existing && input.accountId && input.accountId !== accountId)
      )
        throw new DomainError("UNIPILE_ACCOUNT_REQUIRED", 422);
      const account = unipileV1Account.parse(
        await unipileV1Json(
          configurationCredentials,
          `/accounts/${encodeURIComponent(accountId)}`,
          {},
          this.transport,
        ),
      );
      if (account.id !== accountId)
        throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
      if (unipileV1Status(account) !== "OK")
        throw new DomainError("RECONNECT_REQUIRED", 422);
      const connection = await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(s.providerConfigurations)
          .where(eq(s.providerConfigurations.id, configuration.id))
          .for("update");
        if (!current?.active || current.version !== configuration.version)
          throw new DomainError("STALE_CONFIGURATION", 409);
        return this.saveConnected(
          principal,
          input.organizationId,
          input.productId,
          "linkedin",
          account.id,
          account.name,
          configurationCredentials,
          [],
          existing?.id,
          tx,
          configuration.id,
        );
      });
      publishChange(input.organizationId);
      return { connectionId: connection.id };
    }
    if (input.accountId) throw new DomainError("INVALID_INPUT", 400);
    const state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url"),
      id = randomUUID();
    await this.db.insert(s.integrationFlows).values({
      id,
      stateHash: stateHash(state),
      organizationId: input.organizationId,
      productId: input.productId,
      ownerId: principal.userId,
      provider: input.provider,
      encryptedVerifier: seal(
        {
          verifier,
          allowSending: input.provider === "gmail" && input.allowSending,
          ...(configuration
            ? {
                configurationId: configuration.id,
                configurationVersion: configuration.version,
              }
            : {}),
        },
        id,
      ),
      connectionId: existing?.id,
      expiresAt: new Date(Date.now() + 600000),
    });
    const callback = `${appUrl()}/api/integrations/callback/${input.provider === "linkedin" ? "linkedin" : "google"}`;
    if (input.provider === "linkedin") {
      if (!configuration) throw new DomainError("UNIPILE_SETUP_REQUIRED", 422);
      return {
        url: await hostedLinkedIn(
          unipileCredentials(configuration).apiKey,
          state,
          callback,
          existing?.externalAccountId,
          this.transport,
        ),
      };
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: googleConfig().clientId,
      redirect_uri: callback,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      scope: `openid email ${googleScopes[input.provider]}${input.provider === "gmail" && input.allowSending ? ` ${gmailSendScope}` : ""}`,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.href };
  }
  async flow(state: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state))
      throw new DomainError("INVALID_INPUT", 400);
    const [flow] = await this.db
      .select()
      .from(s.integrationFlows)
      .where(eq(s.integrationFlows.stateHash, stateHash(state)));
    if (!flow || flow.expiresAt < new Date() || flow.consumedAt)
      throw new DomainError("CONNECTION_FLOW_EXPIRED", 400);
    return flow;
  }
  async googleCallback(principal: Principal, state: string, code: string) {
    human(principal);
    const flow = await this.flow(state);
    if (
      flow.ownerId !== principal.userId ||
      !["gmail", "calendar"].includes(flow.provider)
    )
      throw new DomainError("FORBIDDEN", 403);
    await authorize(
      this.db,
      principal,
      flow.organizationId,
      flow.productId,
      true,
    );
    const [claimed] = await this.db
      .update(s.integrationFlows)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(s.integrationFlows.id, flow.id),
          isNull(s.integrationFlows.consumedAt),
        ),
      )
      .returning();
    if (!claimed) throw new DomainError("CONNECTION_FLOW_EXPIRED", 400);
    const { verifier, allowSending } = unseal<{
      verifier: string;
      allowSending?: boolean;
    }>(flow.encryptedVerifier, flow.id);
    const result = await exchangeGoogle(
      code,
      verifier,
      `${appUrl()}/api/integrations/callback/google`,
      this.transport,
    );
    const provider = z.enum(["gmail", "calendar"]).parse(flow.provider);
    if (!result.scopes.includes(googleScopes[provider]))
      throw new DomainError("PROVIDER_PERMISSION", 422);
    if (allowSending && !result.scopes.includes(gmailSendScope))
      throw new DomainError("PROVIDER_PERMISSION", 422);
    await this.saveConnected(
      principal,
      flow.organizationId,
      flow.productId,
      provider,
      result.identity.sub,
      result.identity.email,
      result.credentials,
      result.scopes,
      flow.connectionId ?? undefined,
    );
    return { organizationId: flow.organizationId, productId: flow.productId };
  }
  async saveConnected(
    principal: Principal,
    organizationId: string,
    productId: string,
    provider: IntegrationProvider,
    accountId: string,
    name: string,
    credentials: ProviderCredentials,
    scopes: string[],
    expectedId?: string,
    transaction?: Database,
    providerConfigurationId?: string,
  ) {
    const save = async (tx: Database) => {
      await authorize(tx, principal, organizationId, productId, true);
      // Serialize callbacks within the organization; provider settings namespace account identifiers.
      await tx
        .select({ id: s.organizations.id })
        .from(s.organizations)
        .where(eq(s.organizations.id, organizationId))
        .for("update");
      const [existing] = await tx
        .select()
        .from(s.connections)
        .where(
          and(
            eq(s.connections.provider, dbProvider(provider)),
            eq(s.connections.externalAccountId, accountId),
            providerConfigurationId
              ? eq(
                  s.connections.providerConfigurationId,
                  providerConfigurationId,
                )
              : isNull(s.connections.providerConfigurationId),
          ),
        );
      if (
        existing &&
        (existing.organizationId !== organizationId ||
          existing.ownerId !== principal.userId ||
          existing.productId !== productId)
      )
        throw new DomainError("ACCOUNT_ALREADY_CONNECTED", 409);
      if (expectedId && existing?.id !== expectedId)
        throw new DomainError("ACCOUNT_ALREADY_CONNECTED", 409);
      const id = existing?.id ?? randomUUID();
      const values = {
        organizationId,
        productId,
        ownerId: principal.userId,
        provider: dbProvider(provider),
        externalAccountId: accountId,
        providerConfigurationId: providerConfigurationId ?? null,
        status: "connected",
        displayName: name,
        selfEmail: provider === "linkedin" ? null : name,
        encryptedCredentials: seal(
          credentials,
          credentialContext({ id, organizationId, ownerId: principal.userId }),
        ),
        scopes,
        syncCursor: {
          ...existing?.syncCursor,
          connectedAt:
            existing?.syncCursor.connectedAt ?? new Date().toISOString(),
        },
        errorCode: null,
      };
      const [connection] = existing
        ? await tx
            .update(s.connections)
            .set(values)
            .where(eq(s.connections.id, id))
            .returning()
        : await tx
            .insert(s.connections)
            .values({ id, ...values })
            .returning();
      await tx.insert(s.changeEvents).values({
        organizationId,
        productId,
        actorId: principal.userId,
        type: "connection.connected",
        entityId: id,
      });
      return connection;
    };
    return transaction ? save(transaction) : this.db.transaction(save);
  }
  async linkedInAccount(
    state: string,
    account: unknown,
    configurationId: string,
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state))
      throw new DomainError("INVALID_INPUT", 400);
    const value = z
      .object({
        id: z.string(),
        provider: z.literal("linkedin"),
        name: z.string(),
        status: z.string(),
      })
      .parse(account);
    if (value.status !== "running")
      throw new DomainError("RECONNECT_REQUIRED", 422);
    return this.db.transaction(async (tx) => {
      // Match the verified webhook application before touching its pending flow.
      const [configuration] = await tx
        .select()
        .from(s.providerConfigurations)
        .where(
          and(
            eq(s.providerConfigurations.id, configurationId),
            eq(s.providerConfigurations.active, true),
          ),
        )
        .for("update");
      if (!configuration?.webhookReady)
        throw new DomainError("CONNECTION_FLOW_EXPIRED", 400);
      const [flow] = await tx
        .select()
        .from(s.integrationFlows)
        .where(eq(s.integrationFlows.stateHash, stateHash(state)))
        .for("update");
      if (flow?.provider !== "linkedin" || flow.expiresAt < new Date())
        throw new DomainError("CONNECTION_FLOW_EXPIRED", 400);
      const binding = unseal<{
        configurationId: string;
        configurationVersion: number;
      }>(flow.encryptedVerifier, flow.id);
      if (
        binding.configurationId !== configuration.id ||
        binding.configurationVersion !== configuration.version ||
        configuration.organizationId !== flow.organizationId ||
        configuration.ownerId !== flow.ownerId
      )
        throw new DomainError("CONNECTION_FLOW_EXPIRED", 400);
      if (flow.consumedAt) {
        const [existing] = flow.connectionId
          ? await tx
              .select()
              .from(s.connections)
              .where(eq(s.connections.id, flow.connectionId))
          : [];
        if (
          existing?.status === "connected" &&
          existing.externalAccountId === value.id &&
          existing.ownerId === flow.ownerId &&
          existing.organizationId === flow.organizationId &&
          existing.productId === flow.productId &&
          existing.providerConfigurationId === configuration.id
        )
          return existing;
        throw new DomainError("CONNECTION_FLOW_EXPIRED", 400);
      }
      const connection = await this.saveConnected(
        { userId: flow.ownerId, source: "session" },
        flow.organizationId,
        flow.productId,
        "linkedin",
        value.id,
        value.name,
        { apiKey: unipileCredentials(configuration).apiKey },
        [],
        flow.connectionId ?? undefined,
        tx,
        configuration.id,
      );
      await tx
        .update(s.integrationFlows)
        .set({ consumedAt: new Date(), connectionId: connection.id })
        .where(eq(s.integrationFlows.id, flow.id));
      return connection;
    });
  }
  async linkedInCallback(principal: Principal, state: string) {
    human(principal);
    const [flow] = await this.db
      .select()
      .from(s.integrationFlows)
      .where(eq(s.integrationFlows.stateHash, stateHash(state)));
    if (
      !flow ||
      flow.ownerId !== principal.userId ||
      flow.provider !== "linkedin" ||
      flow.expiresAt < new Date()
    )
      throw new DomainError("CONNECTION_FLOW_EXPIRED", 400);
    await authorize(this.db, principal, flow.organizationId, flow.productId);
    // Only the signed account.add/reconnect webhook can bind the account. The browser query cannot claim an arbitrary account_id.
    return {
      organizationId: flow.organizationId,
      productId: flow.productId,
      pending: !flow.consumedAt,
    };
  }
  async importRecord(
    connection: typeof s.connections.$inferSelect,
    input: ImportRecord,
  ) {
    if (!connection.productId || connection.status !== "connected")
      throw new DomainError("CONNECTION_UNAVAILABLE", 422);
    const record = importRecordSchema.parse(input);
    const item = await this.db.transaction(async (tx) => {
      const [active] = await tx
        .select()
        .from(s.connections)
        .where(
          and(
            eq(s.connections.id, connection.id),
            eq(s.connections.status, "connected"),
          ),
        )
        .for("update");
      if (!active?.productId || !active.encryptedCredentials)
        throw new DomainError("CONNECTION_UNAVAILABLE", 422);
      await authorize(
        tx,
        { userId: active.ownerId, source: "session" },
        active.organizationId,
        active.productId,
        true,
      );
      const [prior] = await tx
        .select()
        .from(s.integrationItems)
        .where(
          and(
            eq(s.integrationItems.connectionId, connection.id),
            eq(s.integrationItems.externalId, record.externalId),
          ),
        );
      if (
        prior?.status === "matched" &&
        isDeepStrictEqual(prior.record, record)
      )
        return null;
      const [linked] =
        record.kind === "message" && record.threadId
          ? await tx
              .select({ id: s.conversations.id })
              .from(s.conversations)
              .where(
                and(
                  eq(s.conversations.connectionId, connection.id),
                  eq(s.conversations.externalThreadId, record.threadId),
                ),
              )
          : [];
      if (
        !prior &&
        !linked &&
        record.kind === "message" &&
        record.direction === "inbound" &&
        record.from &&
        !historicalFor(active, record.occurredAt)
      )
        await pauseForReply(tx, {
          organizationId: active.organizationId,
          personIds: await peopleByEmail(
            tx,
            active.organizationId,
            record.from,
          ),
          occurredAt: new Date(record.occurredAt),
          actorId: active.ownerId,
          pause: true,
        });
      const [item] = await tx
        .insert(s.integrationItems)
        .values({
          organizationId: connection.organizationId,
          productId: active.productId,
          connectionId: connection.id,
          externalId: record.externalId,
          record,
        })
        .onConflictDoUpdate({
          target: [
            s.integrationItems.connectionId,
            s.integrationItems.externalId,
          ],
          set: { record },
        })
        .returning();
      return item;
    });
    if (!item) return;
    if (item.status === "matched" && item.relationshipId)
      await this.materialize(connection, item, item.relationshipId);
    else if (record.kind === "message" && record.threadId) {
      const [conversation] = await this.db
        .select()
        .from(s.conversations)
        .where(
          and(
            eq(s.conversations.connectionId, connection.id),
            eq(s.conversations.externalThreadId, record.threadId),
          ),
        );
      if (conversation)
        await this.materializeThread(
          connection,
          item,
          conversation.relationshipId,
          false,
        );
    }
  }
  async materialize(
    connection: typeof s.connections.$inferSelect,
    item: typeof s.integrationItems.$inferSelect,
    relationshipId: string,
    linkedByMember = false,
  ) {
    const [relationship] = await this.db
      .select()
      .from(s.relationships)
      .where(
        and(
          eq(s.relationships.id, relationshipId),
          eq(s.relationships.organizationId, connection.organizationId),
        ),
      );
    if (!relationship) throw new DomainError("NOT_FOUND", 404);
    const permission: Principal = {
      userId: connection.ownerId,
      source: "session",
    };
    await authorize(
      this.db,
      permission,
      connection.organizationId,
      relationship.productId,
      true,
    );
    const record = item.record;
    if (record.kind === "message") {
      const { threadId, direction } = record;
      if (!threadId || !direction) throw new DomainError("INVALID_INPUT", 400);
      await this.db.transaction(async (tx) => {
        if (linkedByMember)
          await assertActiveRelationships(tx, connection.organizationId, [
            relationshipId,
          ]);
        const [conversation] = await tx
          .insert(s.conversations)
          .values({
            organizationId: connection.organizationId,
            productId: relationship.productId,
            relationshipId,
            connectionId: connection.id,
            externalThreadId: threadId,
            ownerId: connection.ownerId,
            visibility: "private",
            channel: connection.provider === "unipile" ? "linkedin" : "gmail",
          })
          .onConflictDoNothing()
          .returning();
        const [stored] = conversation
          ? [conversation]
          : await tx
              .select()
              .from(s.conversations)
              .where(
                and(
                  eq(s.conversations.connectionId, connection.id),
                  eq(s.conversations.externalThreadId, threadId),
                ),
              );
        if (stored.relationshipId !== relationshipId)
          throw new DomainError("THREAD_ALREADY_LINKED", 409);
        await ingestReply(tx, {
          provider: connection.provider === "unipile" ? "unipile" : "gmail",
          accountId: connection.externalAccountId,
          connectionId: connection.id,
          messageId: record.externalId,
          threadId,
          direction,
          channel: stored.channel,
          body: record.body,
          occurredAt: record.occurredAt,
          ...(record.from ? { from: record.from } : {}),
          historical: historicalFor(connection, record.occurredAt),
        });
        await tx
          .update(s.integrationItems)
          .set({
            status: "matched",
            productId: relationship.productId,
            relationshipId,
            entityId: stored.id,
          })
          .where(eq(s.integrationItems.id, item.id));
      });
    } else {
      // Linking a meeting is an explicit decision to add these notes to this product's shared CRM context.
      await this.db.transaction(async (tx) => {
        const [active] = await tx
          .select()
          .from(s.connections)
          .where(
            and(
              eq(s.connections.id, connection.id),
              eq(s.connections.status, "connected"),
            ),
          )
          .for("update");
        if (!active?.encryptedCredentials)
          throw new DomainError("CONNECTION_UNAVAILABLE", 422);
        await authorize(
          tx,
          permission,
          connection.organizationId,
          relationship.productId,
          true,
        );
        if (linkedByMember)
          await assertActiveRelationships(tx, connection.organizationId, [
            relationshipId,
          ]);
        const [locked] = await tx
          .select()
          .from(s.integrationItems)
          .where(eq(s.integrationItems.id, item.id))
          .for("update");
        const values = {
          organizationId: connection.organizationId,
          productId: relationship.productId,
          relationshipId,
          title: item.record.title,
          startsAt: new Date(item.record.occurredAt),
          status: item.record.canceled
            ? ("canceled" as const)
            : connection.provider === "fireflies"
              ? ("held" as const)
              : ("scheduled" as const),
          summary: item.record.body,
          proposedCommitment: item.record.proposedCommitment ?? null,
        };
        const [meeting] = locked.entityId
          ? await tx
              .update(s.meetings)
              .set({ ...values, version: sql`${s.meetings.version}+1` })
              .where(eq(s.meetings.id, locked.entityId))
              .returning()
          : await tx.insert(s.meetings).values(values).returning();
        await tx
          .update(s.integrationItems)
          .set({
            status: "matched",
            productId: relationship.productId,
            relationshipId,
            entityId: meeting.id,
          })
          .where(eq(s.integrationItems.id, item.id));
        await tx.insert(s.changeEvents).values({
          organizationId: connection.organizationId,
          productId: relationship.productId,
          actorId: connection.ownerId,
          type: "meeting.imported",
          entityId: meeting.id,
        });
      });
    }
    publishChange(connection.organizationId);
  }
  async link(
    principal: Principal,
    organizationId: string,
    id: string,
    relationshipId?: string,
  ) {
    accountActor(principal);
    const [item] = await this.db
      .select()
      .from(s.integrationItems)
      .where(
        and(
          eq(s.integrationItems.id, id),
          eq(s.integrationItems.organizationId, organizationId),
        ),
      );
    if (!item) throw new DomainError("NOT_FOUND", 404);
    const connection = await this.own(
      principal,
      organizationId,
      item.connectionId,
    );
    if (!relationshipId) {
      await this.db
        .update(s.integrationItems)
        .set({ status: "ignored" })
        .where(eq(s.integrationItems.id, id));
      return;
    }
    const [relationship] = await this.db
      .select()
      .from(s.relationships)
      .where(
        and(
          eq(s.relationships.id, relationshipId),
          eq(s.relationships.organizationId, organizationId),
        ),
      );
    if (!relationship) throw new DomainError("NOT_FOUND", 404);
    await authorize(
      this.db,
      principal,
      organizationId,
      relationship.productId,
      true,
    );
    await this.materializeThread(connection, item, relationshipId, true);
  }
  private async materializeThread(
    connection: typeof s.connections.$inferSelect,
    item: typeof s.integrationItems.$inferSelect,
    relationshipId: string,
    linkedByMember: boolean,
  ) {
    if (item.record.kind !== "message" || !item.record.threadId)
      return this.materialize(connection, item, relationshipId, linkedByMember);
    const threadItems = await this.db
      .select()
      .from(s.integrationItems)
      .where(
        and(
          eq(s.integrationItems.connectionId, connection.id),
          eq(s.integrationItems.status, "unmatched"),
          sql`${s.integrationItems.record}->>'threadId' = ${item.record.threadId}`,
        ),
      )
      .orderBy(s.integrationItems.createdAt);
    for (const member of threadItems)
      await this.materialize(
        connection,
        member,
        relationshipId,
        linkedByMember,
      );
  }
  async disconnect(principal: Principal, organizationId: string, id: string) {
    const connection = await this.own(principal, organizationId, id);
    await this.db.transaction(async (tx) => {
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
        .where(eq(s.connections.id, id));
      await tx
        .update(s.integrationFlows)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(s.integrationFlows.organizationId, organizationId),
            eq(s.integrationFlows.ownerId, principal.userId),
            eq(s.integrationFlows.connectionId, id),
          ),
        );
      await tx.insert(s.changeEvents).values({
        organizationId,
        productId: connection.productId,
        actorId: principal.userId,
        type: "connection.disconnected",
        entityId: id,
      });
    });
    publishChange(organizationId);
  }
  async sync(principal: Principal, organizationId: string, id: string) {
    const connection = await this.own(principal, organizationId, id);
    if (connection.status !== "connected" || !connection.encryptedCredentials)
      throw new DomainError("RECONNECT_REQUIRED", 422);
    const leaseId = randomUUID();
    const [leased] = await this.db
      .update(s.connections)
      .set({ leaseId, leaseUntil: new Date(Date.now() + 180000) })
      .where(
        and(
          eq(s.connections.id, id),
          eq(s.connections.status, "connected"),
          or(
            isNull(s.connections.leaseUntil),
            lt(s.connections.leaseUntil, new Date()),
          ),
        ),
      )
      .returning();
    if (!leased) throw new DomainError("SYNC_IN_PROGRESS", 409);
    try {
      let credentials = unseal<ProviderCredentials>(
        leased.encryptedCredentials ?? "",
        credentialContext(leased),
      );
      if (["gmail", "calendar"].includes(leased.provider))
        credentials = await refreshGoogle(credentials, this.transport);
      if (leased.provider === "unipile" && credentials.apiVersion === "v1") {
        const account = unipileV1Account.parse(
          await unipileV1Json(
            credentials,
            `/accounts/${encodeURIComponent(leased.externalAccountId)}`,
            {},
            this.transport,
          ),
        );
        if (account.id !== leased.externalAccountId)
          throw new DomainError("PROVIDER_RESPONSE_INVALID", 502);
        const status = unipileV1Status(account);
        if (status === "CREDENTIALS")
          throw new DomainError("RECONNECT_REQUIRED", 422);
        if (status !== "OK")
          throw new DomainError(
            status === "PERMISSIONS"
              ? "PROVIDER_PERMISSION"
              : "PROVIDER_UNAVAILABLE",
            502,
          );
      }
      const page = await readProviderPage(
        uiProvider(leased.provider),
        credentials,
        leased.externalAccountId,
        leased.selfEmail ?? "",
        leased.syncCursor,
        this.transport,
      );
      // A disconnect cancels the lease; stale workers must not restore credentials or import data.
      const [active] = await this.db
        .select()
        .from(s.connections)
        .where(
          and(
            eq(s.connections.id, id),
            eq(s.connections.leaseId, leaseId),
            eq(s.connections.status, "connected"),
          ),
        );
      if (!active) return { imported: 0, more: false };
      for (const record of page.records)
        await this.importRecord(active, record);
      await this.db
        .update(s.connections)
        .set({
          encryptedCredentials: seal(credentials, credentialContext(active)),
          syncCursor: {
            ...page.cursor,
            connectedAt: active.syncCursor.connectedAt,
            more: page.more,
          },
          lastSyncedAt: new Date(),
          errorCode: null,
          leaseId: null,
          leaseUntil: null,
        })
        .where(
          and(
            eq(s.connections.id, id),
            eq(s.connections.leaseId, leaseId),
            eq(s.connections.status, "connected"),
          ),
        );
      publishChange(organizationId);
      return { imported: page.records.length, more: page.more };
    } catch (error) {
      const code =
        error instanceof DomainError ? error.code : "PROVIDER_RESPONSE_INVALID";
      await this.db
        .update(s.connections)
        .set({
          errorCode: code,
          ...(code === "RECONNECT_REQUIRED"
            ? { status: "reconnect_required" }
            : {}),
          leaseId: null,
          leaseUntil: new Date(Date.now() + 300000),
        })
        .where(
          and(eq(s.connections.id, id), eq(s.connections.leaseId, leaseId)),
        );
      throw new DomainError(code, 502);
    }
  }
}
