import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { publishChange } from "../core/changes";
import { scopeSchema } from "../core/crm";
import { draftHash, draftSubject } from "../core/drafts";
import { OutreachService, outboundGate } from "../core/outreach";
import { authorize, DomainError, type Principal } from "../core/policy";
import { assertActiveRelationships } from "../core/visibility";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { unipileCredentials } from "./configuration";
import {
  dispatchMessage,
  emailDraft,
  gmailSendScope,
  type OutboundMessage,
  prepareReply,
  resolveLinkedInRecipient,
} from "./outbound-provider";
import {
  normalizeGmail,
  normalizeLinkedIn,
  type ProviderFetch,
  providerJson,
  refreshGoogle,
  unipileJson,
} from "./providers";
import { seal, unseal } from "./security";
import type { ProviderCredentials } from "./types";
import { normalizeLinkedInV1, unipileV1Json } from "./unipile-v1";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;
type Delivery = typeof s.deliveries.$inferSelect;
const sourceFields = {
  connectionId: z.uuid(),
  conversationId: z.uuid().optional(),
  version: z.coerce.number().int().positive(),
};
const sendFields = {
  ...sourceFields,
  idempotencyKey: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
};
export const sendTouchSchema = scopeSchema.extend({
  ...sendFields,
  touchId: z.uuid(),
});
export const sendActionSchema = scopeSchema.extend({
  ...sendFields,
  actionId: z.uuid(),
});
export const sendReadinessSchema = scopeSchema
  .extend({
    ...sourceFields,
    touchId: z.uuid().optional(),
    actionId: z.uuid().optional(),
  })
  .refine((input) => Boolean(input.touchId) !== Boolean(input.actionId));
export const deliverySchema = scopeSchema.extend({ deliveryId: z.uuid() });
export const reconcileDeliverySchema = deliverySchema.extend({
  externalMessageId: z.string().min(1).max(500).optional(),
  externalThreadId: z.string().min(1).max(500).optional(),
});
type SourceInput = z.infer<typeof sendReadinessSchema>;
type SendInput = SourceInput & { idempotencyKey: string };
const credentialContext = (row: typeof s.connections.$inferSelect) =>
  `${row.organizationId}:${row.ownerId}:${row.id}`;
const requireSend = (principal: Principal) => {
  if (
    principal.source === "demo" ||
    (principal.source === "mcp" &&
      (principal.canSend !== true || principal.readOnly !== false))
  )
    throw new DomainError("SEND_PERMISSION_REQUIRED", 403);
};
export function publicDelivery(row: Delivery, now = Date.now()) {
  return {
    id: row.id,
    productId: row.productId,
    touchId: row.touchId,
    actionId: row.actionId,
    connectionId: row.connectionId,
    sourceVersion: row.sourceVersion,
    // A worker can die after the provider accepts a message. An abandoned claim is ambiguous, never retryable.
    status:
      row.status === "sending" && now - row.createdAt.getTime() > 120000
        ? "unknown"
        : row.status,
    externalMessageId: row.externalMessageId,
    externalThreadId: row.externalThreadId,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    retrySafe: row.status === "failed",
    providerAccepted: ["accepted", "sent"].includes(row.status),
  };
}
export class OutboundService {
  constructor(
    private db: Database,
    private transport: ProviderFetch = fetch,
    private clock = Date.now,
  ) {}
  private async source(
    db: Reader,
    principal: Principal,
    input: SourceInput,
    lock = false,
  ) {
    const [touch] = input.touchId
      ? await db
          .select()
          .from(s.touches)
          .where(
            and(
              eq(s.touches.id, input.touchId),
              eq(s.touches.organizationId, input.organizationId),
            ),
          )
      : [];
    const [action] = input.actionId
      ? await db
          .select()
          .from(s.actions)
          .where(
            and(
              eq(s.actions.id, input.actionId),
              eq(s.actions.organizationId, input.organizationId),
            ),
          )
      : [];
    const found = touch ?? action;
    if (!found) throw new DomainError("NOT_FOUND", 404);
    await authorize(db, principal, input.organizationId, found.productId, lock);
    if (input.productId && input.productId !== found.productId)
      throw new DomainError("FORBIDDEN", 403);
    if ((touch?.senderId ?? action?.ownerId) !== principal.userId)
      throw new DomainError("FORBIDDEN", 403);
    const [relationship] = await db
      .select()
      .from(s.relationships)
      .where(
        and(
          eq(s.relationships.id, found.relationshipId),
          eq(s.relationships.organizationId, input.organizationId),
          eq(s.relationships.productId, found.productId),
        ),
      );
    if (!relationship) throw new DomainError("NOT_FOUND", 404);
    const peopleQuery = db
      .select()
      .from(s.people)
      .where(
        and(
          eq(s.people.id, relationship.personId),
          eq(s.people.organizationId, input.organizationId),
        ),
      );
    const [person] = await (lock ? peopleQuery.for("update") : peopleQuery);
    if (!person) throw new DomainError("NOT_FOUND", 404);
    await assertActiveRelationships(db, input.organizationId, [
      relationship.id,
    ]);
    // Every sender's claims serialize, including different contacts, products and channels.
    if (lock)
      await db
        .select({ id: s.memberships.id })
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.organizationId, input.organizationId),
            eq(s.memberships.userId, principal.userId),
          ),
        )
        .for("no key update");
    // Recheck membership after waiting for the quota lock: revocation may have
    // committed since the first authorization read.
    if (lock)
      await authorize(
        db,
        principal,
        input.organizationId,
        found.productId,
        true,
      );
    const enrollmentQuery = touch
      ? db
          .select()
          .from(s.enrollments)
          .where(eq(s.enrollments.id, touch.enrollmentId))
      : null;
    const [enrollment] = enrollmentQuery
      ? await (lock ? enrollmentQuery.for("update") : enrollmentQuery)
      : [];
    const sourceQuery = touch
      ? db.select().from(s.touches).where(eq(s.touches.id, touch.id))
      : db
          .select()
          .from(s.actions)
          .where(eq(s.actions.id, action?.id ?? ""));
    const [record] = await (lock ? sourceQuery.for("update") : sourceQuery);
    if (!record) throw new DomainError("NOT_FOUND", 404);
    if (
      (touch
        ? (record as typeof s.touches.$inferSelect).senderId
        : (record as typeof s.actions.$inferSelect).ownerId) !==
      principal.userId
    )
      throw new DomainError("FORBIDDEN", 403);
    const [connection] = await db
      .select()
      .from(s.connections)
      .where(
        and(
          eq(s.connections.id, input.connectionId),
          eq(s.connections.organizationId, input.organizationId),
          eq(s.connections.ownerId, principal.userId),
        ),
      );
    if (!connection?.productId) throw new DomainError("NOT_FOUND", 404);
    // The default product scopes account access; explicitly linked context may
    // belong to another product. Both authorizations are required.
    await authorize(
      db,
      principal,
      input.organizationId,
      connection.productId,
      lock,
    );
    if (
      !["gmail", "linkedin"].includes(record.channel) ||
      connection.provider !==
        (record.channel === "linkedin" ? "unipile" : "gmail")
    )
      throw new DomainError("CHANNEL_MISMATCH", 422);
    const sourceConversationId = action?.sourceConversationId;
    if (
      sourceConversationId &&
      input.conversationId &&
      sourceConversationId !== input.conversationId
    )
      throw new DomainError("FORBIDDEN", 403);
    const conversationId = sourceConversationId ?? input.conversationId;
    const [conversation] = conversationId
      ? await db
          .select()
          .from(s.conversations)
          .where(
            and(
              eq(s.conversations.id, conversationId),
              eq(s.conversations.organizationId, input.organizationId),
              eq(s.conversations.productId, record.productId),
              eq(s.conversations.relationshipId, relationship.id),
              eq(s.conversations.connectionId, connection.id),
              eq(s.conversations.ownerId, principal.userId),
              eq(
                s.conversations.channel,
                record.channel as "gmail" | "linkedin",
              ),
            ),
          )
      : [];
    if (conversationId && !conversation)
      throw new DomainError("FORBIDDEN", 403);
    const hash = draftHash({
      draft: record.draft,
      ...(await draftSubject(db, person)),
      channel: record.channel,
      productId: record.productId,
    });
    const gate = await outboundGate(
      db,
      input.organizationId,
      principal.userId,
      person,
      this.clock(),
    );
    return {
      touch: !!touch,
      record,
      relationship,
      person,
      connection,
      conversation,
      hash,
      gate,
      enrollment,
    };
  }
  private assertReady(
    source: Awaited<ReturnType<OutboundService["source"]>>,
    input: SourceInput,
  ) {
    const { record, touch, person, connection, enrollment, gate, hash } =
      source;
    if (record.version !== input.version)
      throw new DomainError("CONFLICT", 409);
    if (person.doNotContact) throw new DomainError("DO_NOT_CONTACT", 409);
    if (
      touch
        ? record.status !== "approved" || enrollment?.status !== "running"
        : record.status !== "open"
    )
      throw new DomainError("SOURCE_NOT_SENDABLE", 409);
    if (
      !record.draft.trim() ||
      record.approvedHash !== hash ||
      record.draftHash !== hash
    )
      throw new DomainError("FRESH_APPROVAL_REQUIRED", 409);
    if (record.dueAt.getTime() > this.clock())
      throw new DomainError("TOUCH_NOT_DUE", 409);
    if (!gate.allowed)
      throw new DomainError("CONTACT_POLICY_BLOCKED", 409, {
        reason: gate.reasons[0]?.code ?? "blocked",
        sendAfter: gate.sendAfter ? new Date(gate.sendAfter).toISOString() : "",
      });
    if (connection.status !== "connected" || !connection.encryptedCredentials)
      throw new DomainError("RECONNECT_REQUIRED", 422);
    if (
      record.channel === "gmail" &&
      !connection.scopes.includes(gmailSendScope)
    )
      throw new DomainError("GMAIL_SEND_CONSENT_REQUIRED", 422);
    if (record.channel === "gmail") {
      z.email().parse(person.email);
      z.email().parse(connection.selfEmail);
      emailDraft(record.draft);
    }
    if (
      record.channel === "linkedin" &&
      !source.conversation &&
      !person.linkedinUrl
    )
      throw new DomainError("LINKEDIN_PROFILE_REQUIRED", 422);
  }
  async readiness(principal: Principal, input: SourceInput) {
    input = sendReadinessSchema.parse(input);
    const source = await this.source(this.db, principal, input);
    let blockedBy: string | null = null;
    try {
      requireSend(principal);
      this.assertReady(source, input);
      const [pending] = await this.db
        .select({ id: s.deliveries.id })
        .from(s.deliveries)
        .innerJoin(
          s.relationships,
          eq(s.relationships.id, s.deliveries.relationshipId),
        )
        .where(
          and(
            eq(s.deliveries.organizationId, input.organizationId),
            eq(s.relationships.personId, source.person.id),
            inArray(s.deliveries.status, ["sending", "unknown", "accepted"]),
          ),
        );
      if (pending) blockedBy = "DELIVERY_IN_PROGRESS";
    } catch (error) {
      blockedBy = error instanceof DomainError ? error.code : "INVALID_INPUT";
    }
    return {
      sourceVersion: source.record.version,
      productId: source.record.productId,
      channel: source.record.channel,
      ready: blockedBy === null,
      blockedBy,
      approved: source.record.approvedHash === source.hash,
      recipient:
        source.record.channel === "gmail"
          ? source.person.email
          : source.person.linkedinUrl,
      draft: source.record.draft,
      connectionId: source.connection.id,
      conversationId: source.conversation?.id ?? null,
      policy: {
        ...source.gate,
        sendAfter:
          source.gate.sendAfter === null
            ? null
            : new Date(source.gate.sendAfter).toISOString(),
        reasons: source.gate.reasons.map((reason) => ({
          ...reason,
          ...("until" in reason
            ? { until: new Date(reason.until).toISOString() }
            : {}),
        })),
      },
      providerAuthorizationRequired:
        blockedBy === "GMAIL_SEND_CONSENT_REQUIRED",
    };
  }
  private async credentials(connection: typeof s.connections.$inferSelect) {
    let credentials = unseal<ProviderCredentials>(
      connection.encryptedCredentials ?? "",
      credentialContext(connection),
    );
    if (connection.provider === "gmail")
      credentials = await refreshGoogle(credentials, this.transport);
    else {
      if (!connection.providerConfigurationId)
        throw new DomainError("RECONNECT_REQUIRED", 422);
      const [configuration] = await this.db
        .select()
        .from(s.providerConfigurations)
        .where(
          and(
            eq(s.providerConfigurations.id, connection.providerConfigurationId),
            eq(
              s.providerConfigurations.organizationId,
              connection.organizationId,
            ),
            eq(s.providerConfigurations.ownerId, connection.ownerId),
            eq(s.providerConfigurations.active, true),
          ),
        );
      if (!configuration) throw new DomainError("RECONNECT_REQUIRED", 422);
      credentials = unipileCredentials(configuration);
    }
    return credentials;
  }
  private async owned(
    principal: Principal,
    organizationId: string,
    deliveryId: string,
    productId?: string,
  ) {
    const [row] = await this.db
      .select()
      .from(s.deliveries)
      .where(
        and(
          eq(s.deliveries.id, deliveryId),
          eq(s.deliveries.organizationId, organizationId),
          eq(s.deliveries.ownerId, principal.userId),
        ),
      );
    if (!row) throw new DomainError("NOT_FOUND", 404);
    await authorize(this.db, principal, organizationId, row.productId);
    if (productId && productId !== row.productId)
      throw new DomainError("FORBIDDEN", 403);
    return row;
  }
  async get(principal: Principal, input: z.infer<typeof deliverySchema>) {
    return publicDelivery(
      await this.owned(
        principal,
        input.organizationId,
        input.deliveryId,
        input.productId,
      ),
      this.clock(),
    );
  }
  async send(principal: Principal, input: SendInput) {
    requireSend(principal);
    if (Boolean(input.touchId) === Boolean(input.actionId))
      throw new DomainError("INVALID_INPUT", 400);
    const parsed = (input.touchId ? sendTouchSchema : sendActionSchema).parse(
      input,
    );
    input = parsed;
    const hash = createHash("sha256")
      .update(JSON.stringify(parsed))
      .digest("hex");
    const existingQuery = (db: Reader) =>
      db
        .select()
        .from(s.deliveries)
        .where(
          and(
            eq(s.deliveries.organizationId, input.organizationId),
            eq(s.deliveries.ownerId, principal.userId),
            eq(s.deliveries.idempotencyKey, parsed.idempotencyKey),
          ),
        );
    const [existing] = await existingQuery(this.db);
    if (existing) {
      await this.owned(
        principal,
        input.organizationId,
        existing.id,
        input.productId,
      );
      await authorize(
        this.db,
        principal,
        input.organizationId,
        existing.productId,
        true,
      );
      if (existing.requestHash !== hash)
        throw new DomainError("IDEMPOTENCY_CONFLICT", 409);
      if (existing.status === "accepted") await this.finalize(existing);
      return this.get(principal, {
        organizationId: input.organizationId,
        deliveryId: existing.id,
      });
    }
    const source = await this.source(this.db, principal, input);
    await authorize(
      this.db,
      principal,
      input.organizationId,
      source.record.productId,
      true,
    );
    this.assertReady(source, input);
    const credentials = await this.credentials(source.connection);
    const deliveryId = randomUUID();
    const draft =
      source.record.channel === "gmail"
        ? emailDraft(source.record.draft)
        : { subject: "", body: source.record.draft };
    const recipient =
      source.record.channel === "gmail"
        ? (source.person.email ?? "")
        : source.conversation
          ? source.person.linkedinUrl
          : await resolveLinkedInRecipient(
              source.connection.externalAccountId,
              source.person.linkedinUrl,
              credentials,
              this.transport,
            );
    const message: OutboundMessage = await prepareReply(
      {
        channel: source.record.channel as "gmail" | "linkedin",
        accountId: source.connection.externalAccountId,
        from: source.connection.selfEmail ?? "",
        recipient,
        ...draft,
        threadId: source.conversation?.externalThreadId,
        messageId: `gravity.${deliveryId}@${source.connection.selfEmail?.split("@")[1] ?? "gravity.invalid"}`,
      },
      credentials,
      this.transport,
    );
    const claim = await this.db.transaction(async (tx) => {
      const current = await this.source(tx, principal, input, true);
      const [duplicate] = await existingQuery(tx);
      if (duplicate) {
        if (duplicate.requestHash !== hash)
          throw new DomainError("IDEMPOTENCY_CONFLICT", 409);
        return { delivery: duplicate, claimed: false };
      }
      this.assertReady(current, input);
      if (
        current.hash !== source.hash ||
        current.connection.encryptedCredentials !==
          source.connection.encryptedCredentials ||
        current.connection.externalAccountId !==
          source.connection.externalAccountId ||
        current.conversation?.externalThreadId !==
          source.conversation?.externalThreadId
      )
        throw new DomainError("CONFLICT", 409);
      const [pending] = await tx
        .select({ id: s.deliveries.id })
        .from(s.deliveries)
        .innerJoin(
          s.relationships,
          eq(s.relationships.id, s.deliveries.relationshipId),
        )
        .where(
          and(
            eq(s.deliveries.organizationId, input.organizationId),
            eq(s.relationships.personId, current.person.id),
            inArray(s.deliveries.status, ["sending", "unknown", "accepted"]),
          ),
        );
      if (pending) throw new DomainError("DELIVERY_IN_PROGRESS", 409);
      const [alreadySent] = await tx
        .select({ id: s.deliveries.id })
        .from(s.deliveries)
        .where(
          and(
            input.touchId
              ? eq(s.deliveries.touchId, input.touchId)
              : and(
                  eq(s.deliveries.actionId, input.actionId ?? ""),
                  eq(s.deliveries.sourceVersion, input.version),
                ),
            inArray(s.deliveries.status, [
              "sending",
              "unknown",
              "accepted",
              "sent",
            ]),
          ),
        );
      if (alreadySent) throw new DomainError("SOURCE_ALREADY_DISPATCHED", 409);
      const [delivery] = await tx
        .insert(s.deliveries)
        .values({
          id: deliveryId,
          organizationId: input.organizationId,
          productId: current.record.productId,
          relationshipId: current.relationship.id,
          ownerId: principal.userId,
          connectionId: current.connection.id,
          touchId: input.touchId,
          actionId: input.actionId,
          sourceVersion: input.version,
          idempotencyKey: parsed.idempotencyKey,
          requestHash: hash,
          channel: message.channel,
          recipient,
          draft: current.record.draft,
          subject: message.subject,
          externalThreadId: message.threadId,
          status: "sending",
          createdAt: new Date(this.clock()),
        })
        .returning();
      if (!delivery) throw new DomainError("INTERNAL_ERROR", 500);
      await tx.insert(s.changeEvents).values({
        organizationId: delivery.organizationId,
        productId: delivery.productId,
        actorId: principal.userId,
        type: "delivery.claimed",
        entityId: delivery.id,
      });
      return { delivery, claimed: true };
    });
    if (!claim.claimed)
      return this.get(principal, {
        organizationId: input.organizationId,
        deliveryId: claim.delivery.id,
      });
    // No provider call is retried here. Timeouts, malformed receipts and 5xx responses are ambiguous.
    let receipt: Awaited<ReturnType<typeof dispatchMessage>>;
    try {
      receipt = await dispatchMessage(message, credentials, this.transport);
    } catch (error) {
      const status =
        error instanceof DomainError
          ? (error as DomainError & { providerStatus?: number }).providerStatus
          : undefined;
      const definite =
        status !== undefined && [400, 401, 403, 404, 422, 429].includes(status);
      const errorCode =
        error instanceof DomainError ? error.code : "PROVIDER_RESPONSE_INVALID";
      await this.db.transaction(async (tx) => {
        await tx
          .update(s.deliveries)
          .set({ status: definite ? "failed" : "unknown", errorCode })
          .where(eq(s.deliveries.id, deliveryId));
        await tx.insert(s.changeEvents).values({
          organizationId: input.organizationId,
          productId: claim.delivery.productId,
          actorId: principal.userId,
          type: definite ? "delivery.failed" : "delivery.unknown",
          entityId: deliveryId,
        });
      });
      publishChange(input.organizationId);
      return this.get(principal, {
        organizationId: input.organizationId,
        deliveryId,
      });
    }
    const [accepted] = await this.db
      .update(s.deliveries)
      .set({ ...receipt, status: "accepted", sentAt: new Date(this.clock()) })
      .where(eq(s.deliveries.id, deliveryId))
      .returning();
    if (accepted) await this.finalize(accepted);
    // Credential refresh is saved with a compare-and-swap; a concurrent disconnect cannot be undone.
    if (source.connection.provider === "gmail")
      await this.db
        .update(s.connections)
        .set({
          encryptedCredentials: seal(
            credentials,
            credentialContext(source.connection),
          ),
        })
        .where(
          and(
            eq(s.connections.id, source.connection.id),
            eq(s.connections.status, "connected"),
            eq(
              s.connections.encryptedCredentials,
              source.connection.encryptedCredentials ?? "",
            ),
          ),
        );
    publishChange(input.organizationId);
    return this.get(principal, {
      organizationId: input.organizationId,
      deliveryId,
    });
  }
  private async finalize(delivery: Delivery) {
    const now = delivery.sentAt ?? new Date(this.clock());
    await this.db.transaction(async (tx) => {
      // Persist a receipt even if a reply, archive or revoked membership arrived while the network was in flight.
      const [relationship] = await tx
        .select()
        .from(s.relationships)
        .where(eq(s.relationships.id, delivery.relationshipId));
      if (!relationship) throw new DomainError("NOT_FOUND", 404);
      await tx
        .select({ id: s.people.id })
        .from(s.people)
        .where(eq(s.people.id, relationship.personId))
        .for("update");
      const [current] = await tx
        .select()
        .from(s.deliveries)
        .where(eq(s.deliveries.id, delivery.id))
        .for("update");
      if (
        current?.status !== "accepted" ||
        !current.externalMessageId ||
        !current.externalThreadId
      )
        return;
      const messageId =
        current.channel === "linkedin"
          ? `${current.externalThreadId}:${current.externalMessageId}`
          : current.externalMessageId;
      let conflicted = false;
      if (current.touchId) {
        const [touch] = await tx
          .select()
          .from(s.touches)
          .where(eq(s.touches.id, current.touchId))
          .for("update");
        conflicted = touch?.version !== current.sourceVersion;
        if (touch && touch.status !== "sent")
          await tx
            .update(s.touches)
            .set({
              status: "sent",
              sentAt: now,
              sentBy: current.ownerId,
              externalMessageId: messageId,
              closedAt: now,
              updatedAt: now,
              version: touch.version + 1,
              sentWarnings: conflicted ? ["changed-during-dispatch"] : [],
            })
            .where(eq(s.touches.id, touch.id));
      } else if (current.actionId) {
        const [action] = await tx
          .select()
          .from(s.actions)
          .where(eq(s.actions.id, current.actionId))
          .for("update");
        conflicted = action?.version !== current.sourceVersion;
        // A newer inbound reply must remain actionable. Its replacement draft is never completed by an older send.
        if (action?.version === current.sourceVersion)
          await tx
            .update(s.actions)
            .set({ status: "completed", version: action.version + 1 })
            .where(eq(s.actions.id, action.id));
      }
      const [inserted] = await tx
        .insert(s.conversations)
        .values({
          organizationId: current.organizationId,
          productId: current.productId,
          relationshipId: current.relationshipId,
          connectionId: current.connectionId,
          externalThreadId: current.externalThreadId,
          ownerId: current.ownerId,
          visibility: "private",
          channel: current.channel,
        })
        .onConflictDoNothing()
        .returning();
      const [conversation] = inserted
        ? [inserted]
        : await tx
            .select()
            .from(s.conversations)
            .where(
              and(
                eq(s.conversations.connectionId, current.connectionId),
                eq(s.conversations.externalThreadId, current.externalThreadId),
              ),
            );
      if (
        !conversation ||
        conversation.relationshipId !== current.relationshipId ||
        conversation.ownerId !== current.ownerId
      )
        throw new DomainError("THREAD_ALREADY_LINKED", 409);
      await tx
        .insert(s.messages)
        .values({
          organizationId: current.organizationId,
          productId: current.productId,
          conversationId: conversation.id,
          connectionId: current.connectionId,
          providerMessageId: messageId,
          direction: "outbound",
          body: current.draft,
          occurredAt: now,
        })
        .onConflictDoNothing();
      await tx
        .update(s.relationships)
        .set({
          touchCount: sql`${s.relationships.touchCount} + 1`,
          lastOutboundAt: sql`greatest(coalesce(${s.relationships.lastOutboundAt}, ${now.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz)`,
          version: sql`${s.relationships.version} + 1`,
        })
        .where(eq(s.relationships.id, current.relationshipId));
      await tx
        .update(s.deliveries)
        .set({
          status: "sent",
          errorCode: conflicted ? "SOURCE_CHANGED_DURING_DISPATCH" : null,
        })
        .where(eq(s.deliveries.id, current.id));
      await tx.insert(s.changeEvents).values({
        organizationId: current.organizationId,
        productId: current.productId,
        actorId: current.ownerId,
        type: "delivery.sent",
        entityId: current.id,
      });
    });
    // Planning only: advancing never dispatches the next touch.
    if (delivery.touchId) {
      const principal: Principal = {
        userId: delivery.ownerId,
        source: "session",
        productIds: [delivery.productId],
      };
      try {
        await new OutreachService(this.db, this.clock).advanceEnrollments(
          principal,
          { organizationId: delivery.organizationId },
        );
      } catch {
        /* A removed membership must not erase an already persisted receipt. */
      }
    }
  }
  async reconcile(
    principal: Principal,
    input: z.infer<typeof reconcileDeliverySchema>,
  ) {
    requireSend(principal);
    const delivery = await this.owned(
      principal,
      input.organizationId,
      input.deliveryId,
      input.productId,
    );
    await authorize(
      this.db,
      principal,
      input.organizationId,
      delivery.productId,
      true,
    );
    if (delivery.status === "sent" || delivery.status === "failed")
      return publicDelivery(delivery, this.clock());
    if (delivery.status === "accepted") {
      await this.finalize(delivery);
      return this.get(principal, input);
    }
    if (
      delivery.status === "sending" &&
      this.clock() - delivery.createdAt.getTime() < 120000
    )
      throw new DomainError("DELIVERY_IN_PROGRESS", 409);
    const [connection] = await this.db
      .select()
      .from(s.connections)
      .where(
        and(
          eq(s.connections.id, delivery.connectionId),
          eq(s.connections.organizationId, delivery.organizationId),
          eq(s.connections.ownerId, principal.userId),
          eq(s.connections.status, "connected"),
        ),
      );
    if (!connection?.productId)
      throw new DomainError("RECONNECT_REQUIRED", 422);
    await authorize(
      this.db,
      principal,
      input.organizationId,
      connection.productId,
      true,
    );
    const credentials = await this.credentials(connection);
    let receipt: {
      externalMessageId: string;
      externalThreadId: string;
      sentAt: Date;
    };
    if (delivery.channel === "gmail") {
      const messageId = `gravity.${delivery.id}@${connection.selfEmail?.split("@")[1] ?? "gravity.invalid"}`;
      const headers = { Authorization: `Bearer ${credentials.accessToken}` };
      const matches = z
        .object({ messages: z.array(z.object({ id: z.string() })).optional() })
        .parse(
          await providerJson(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=2&q=${encodeURIComponent(`rfc822msgid:${messageId}`)}`,
            { headers },
            this.transport,
          ),
        );
      if (matches.messages?.length !== 1)
        throw new DomainError("DELIVERY_OUTCOME_UNKNOWN", 409);
      const raw = await providerJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(matches.messages[0].id)}?format=full`,
        { headers },
        this.transport,
      );
      const record = normalizeGmail(raw, connection.selfEmail ?? "");
      const expected = emailDraft(delivery.draft);
      const proof = z
        .object({
          payload: z.object({
            headers: z.array(z.object({ name: z.string(), value: z.string() })),
          }),
        })
        .parse(raw);
      const sentHeader = (name: string) =>
        proof.payload.headers.find(
          (header) => header.name.toLowerCase() === name,
        )?.value;
      if (
        record?.direction !== "outbound" ||
        !record.threadId ||
        sentHeader("message-id") !== `<${messageId}>` ||
        sentHeader("to")?.trim().toLowerCase() !==
          delivery.recipient.toLowerCase() ||
        record.from !== connection.selfEmail?.toLowerCase() ||
        Date.parse(record.occurredAt) < delivery.createdAt.getTime() ||
        (delivery.externalThreadId !== null &&
          delivery.externalThreadId !== record.threadId) ||
        record.title !== expected.subject ||
        !record.participants.includes(delivery.recipient.toLowerCase()) ||
        record.body.replace(/\r\n/g, "\n").trim() !==
          expected.body.replace(/\r\n/g, "\n").trim()
      )
        throw new DomainError("RECEIPT_MISMATCH", 409);
      receipt = {
        externalMessageId: record.externalId,
        externalThreadId: record.threadId,
        sentAt: new Date(record.occurredAt),
      };
    } else {
      // Without provider idempotency, identical text is not proof of a send. Verify a supplied receipt on the original account/chat.
      const threadId = delivery.externalThreadId;
      if (
        !threadId ||
        !input.externalMessageId ||
        (input.externalThreadId && input.externalThreadId !== threadId)
      )
        throw new DomainError("DELIVERY_OUTCOME_UNKNOWN", 409);
      const raw =
        credentials.apiVersion === "v1"
          ? await unipileV1Json(
              credentials,
              `/messages/${encodeURIComponent(input.externalMessageId)}`,
              {},
              this.transport,
            )
          : await unipileJson(
              credentials.apiKey ?? "",
              `/${encodeURIComponent(connection.externalAccountId)}/chats/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(input.externalMessageId)}`,
              {},
              this.transport,
            );
      const record =
        credentials.apiVersion === "v1"
          ? normalizeLinkedInV1(raw, connection.externalAccountId, threadId)
          : normalizeLinkedIn(raw);
      if (
        record?.direction !== "outbound" ||
        record.threadId !== threadId ||
        record.externalId !== `${threadId}:${input.externalMessageId}` ||
        record.body !== delivery.draft ||
        Date.parse(record.occurredAt) < delivery.createdAt.getTime()
      )
        throw new DomainError("RECEIPT_MISMATCH", 409);
      receipt = {
        externalMessageId: input.externalMessageId,
        externalThreadId: threadId,
        sentAt: new Date(record.occurredAt),
      };
    }
    const [accepted] = await this.db
      .update(s.deliveries)
      .set({ ...receipt, status: "accepted", errorCode: null })
      .where(
        and(
          eq(s.deliveries.id, delivery.id),
          inArray(s.deliveries.status, ["sending", "unknown"]),
        ),
      )
      .returning();
    if (accepted) await this.finalize(accepted);
    publishChange(input.organizationId);
    return this.get(principal, input);
  }
}
