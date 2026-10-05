import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { appUrl } from "../auth/options";
import { publishChange } from "../core/changes";
import { authorize, DomainError, type Principal } from "../core/policy";
import type { Database } from "../database/client";
import * as s from "../database/schema";
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

export const integrationScope = z.object({
  organizationId: z.uuid(),
  productId: z.uuid().optional(),
});
export const connectInput = integrationScope.extend({
  productId: z.uuid(),
  provider: integrationProvider,
  apiKey: z.string().min(10).max(2000).optional(),
  connectionId: z.uuid().optional(),
});
const human = (principal: Principal) => {
  if (principal.source !== "session")
    throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
};
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
    linkedin:
      key &&
      !!process.env.UNIPILE_API_KEY &&
      !!process.env.UNIPILE_WEBHOOK_SECRET,
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
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    errorCode: connection.errorCode,
    more: !!connection.syncCursor.more,
  };
}
export type PublicConnection = ReturnType<typeof publicConnection>;
export interface ConnectionOverview {
  configured: ReturnType<typeof integrationAvailability>;
  connections: PublicConnection[];
  items: {
    id: string;
    connectionId: string;
    productId: string;
    record: ImportRecord;
  }[];
}
export class IntegrationService {
  constructor(
    private db: Database,
    private transport: ProviderFetch = fetch,
  ) {}
  async overview(
    principal: Principal,
    scope: z.infer<typeof integrationScope>,
  ): Promise<ConnectionOverview> {
    human(principal);
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
            scope.productId
              ? [scope.productId]
              : allowed.products.map((p) => p.id),
          ),
        ),
      );
    const items = await this.db
      .select({
        id: s.integrationItems.id,
        connectionId: s.integrationItems.connectionId,
        productId: s.integrationItems.productId,
        record: s.integrationItems.record,
      })
      .from(s.integrationItems)
      .where(
        and(
          eq(s.integrationItems.organizationId, scope.organizationId),
          inArray(
            s.integrationItems.connectionId,
            rows.map((r) => r.id),
          ),
          inArray(
            s.integrationItems.productId,
            allowed.products.map((p) => p.id),
          ),
          eq(s.integrationItems.status, "unmatched"),
        ),
      )
      .orderBy(desc(s.integrationItems.createdAt))
      .limit(50);
    return {
      configured: integrationAvailability(),
      connections: rows.map(publicConnection),
      items,
    };
  }
  async own(
    principal: Principal,
    organizationId: string,
    id: string,
    write = true,
  ) {
    human(principal);
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
  async connect(principal: Principal, input: z.infer<typeof connectInput>) {
    human(principal);
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
      encryptedVerifier: seal({ verifier }, id),
      connectionId: existing?.id,
      expiresAt: new Date(Date.now() + 600000),
    });
    const callback = `${appUrl()}/api/integrations/callback/${input.provider === "linkedin" ? "linkedin" : "google"}`;
    if (input.provider === "linkedin")
      return {
        url: await hostedLinkedIn(
          state,
          callback,
          existing?.externalAccountId,
          this.transport,
        ),
      };
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: googleConfig().clientId,
      redirect_uri: callback,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      scope: `openid email ${googleScopes[input.provider]}`,
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
    const { verifier } = unseal<{ verifier: string }>(
      flow.encryptedVerifier,
      flow.id,
    );
    const result = await exchangeGoogle(
      code,
      verifier,
      `${appUrl()}/api/integrations/callback/google`,
      this.transport,
    );
    const provider = z.enum(["gmail", "calendar"]).parse(flow.provider);
    if (!result.scopes.includes(googleScopes[provider]))
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
  ) {
    const save = async (tx: Database) => {
      await authorize(tx, principal, organizationId, productId, true);
      // Serialize callbacks within the organization; the global unique key also prevents cross-tenant claims.
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
  async linkedInAccount(state: string, account: unknown) {
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
      const [flow] = await tx
        .select()
        .from(s.integrationFlows)
        .where(eq(s.integrationFlows.stateHash, stateHash(state)))
        .for("update");
      if (flow?.provider !== "linkedin" || flow.expiresAt < new Date())
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
          existing.productId === flow.productId
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
        {},
        [],
        flow.connectionId ?? undefined,
        tx,
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
        await this.link(
          { userId: connection.ownerId, source: "session" },
          connection.organizationId,
          item.id,
          conversation.relationshipId,
        );
    }
  }
  async materialize(
    connection: typeof s.connections.$inferSelect,
    item: typeof s.integrationItems.$inferSelect,
    relationshipId: string,
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
    if (item.record.kind === "message") {
      if (!item.record.threadId || !item.record.direction)
        throw new DomainError("INVALID_INPUT", 400);
      const [conversation] = await this.db
        .insert(s.conversations)
        .values({
          organizationId: connection.organizationId,
          productId: relationship.productId,
          relationshipId,
          connectionId: connection.id,
          externalThreadId: item.record.threadId,
          ownerId: connection.ownerId,
          visibility: "private",
          channel: connection.provider === "unipile" ? "linkedin" : "gmail",
        })
        .onConflictDoNothing()
        .returning();
      const [stored] = conversation
        ? [conversation]
        : await this.db
            .select()
            .from(s.conversations)
            .where(
              and(
                eq(s.conversations.connectionId, connection.id),
                eq(s.conversations.externalThreadId, item.record.threadId),
              ),
            );
      if (stored.relationshipId !== relationshipId)
        throw new DomainError("THREAD_ALREADY_LINKED", 409);
      await ingestReply(this.db, {
        provider: connection.provider === "unipile" ? "unipile" : "gmail",
        accountId: connection.externalAccountId,
        messageId: item.record.externalId,
        threadId: item.record.threadId,
        direction: item.record.direction,
        channel: stored.channel,
        body: item.record.body,
        occurredAt: item.record.occurredAt,
        historical:
          typeof connection.syncCursor.connectedAt === "string" &&
          new Date(item.record.occurredAt) <
            new Date(connection.syncCursor.connectedAt),
      });
      await this.db
        .update(s.integrationItems)
        .set({
          status: "matched",
          productId: relationship.productId,
          relationshipId,
          entityId: stored.id,
        })
        .where(eq(s.integrationItems.id, item.id));
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
    human(principal);
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
    if (item.record.kind === "message" && item.record.threadId) {
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
        await this.materialize(connection, member, relationshipId);
    } else await this.materialize(connection, item, relationshipId);
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
