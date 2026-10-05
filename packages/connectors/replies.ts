import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import { DomainError } from "../core/policy";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import t from "../i18n/translations/en.json";

export const replySchema = z.object({
  provider: z.enum(["gmail", "unipile"]),
  accountId: z.string().min(1).max(500),
  connectionId: z.uuid().optional(),
  messageId: z.string().min(1).max(500),
  threadId: z.string().min(1).max(500),
  direction: z.enum(["inbound", "outbound"]),
  channel: z.enum(["gmail", "linkedin"]),
  body: z.string().max(100000),
  occurredAt: z.iso.datetime(),
  historical: z.boolean().optional(),
});
export type ReplyEvent = z.infer<typeof replySchema>;
export function verifyUnipileSignature(
  raw: Uint8Array,
  header: string | null,
  secret: string,
  now = Date.now(),
) {
  if (!header || !secret) return false;
  const match = /^t=(\d+),v0=([a-f0-9]{64})$/.exec(header);
  if (!match || Math.abs(now / 1000 - Number(match[1])) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${match[1]}.`)
    .update(raw)
    .digest();
  return timingSafeEqual(expected, Buffer.from(match[2], "hex"));
}
export const unipileEnvelope = z.object({
  id: z.string().min(1),
  account_id: z.string().min(1),
  account_provider: z.string(),
  type: z.string(),
  payload: z.unknown(),
});
export function normalizeUnipileV2(
  payload: unknown,
  mailbox?: {
    selfEmail: string | null;
    inboxFolderIds: string[];
    sentFolderIds: string[];
  },
): ReplyEvent | null {
  const event = unipileEnvelope.parse(payload);
  if (
    event.type === "message.new" &&
    event.account_provider.toUpperCase() === "LINKEDIN"
  ) {
    const message = z
      .object({
        id: z.string(),
        chat_id: z.string(),
        is_sender: z.boolean(),
        is_event: z.boolean(),
        text: z.string().optional(),
        timestamp: z.iso.datetime(),
      })
      .parse(event.payload);
    if (message.is_event) return null;
    return replySchema.parse({
      provider: "unipile",
      accountId: event.account_id,
      messageId: message.id,
      threadId: message.chat_id,
      direction: message.is_sender ? "outbound" : "inbound",
      channel: "linkedin",
      body: message.text ?? "",
      occurredAt: message.timestamp,
    });
  }
  if (
    event.type === "email.new" &&
    event.account_provider.toUpperCase() === "GOOGLE"
  ) {
    const mail = z
      .object({
        folder_id: z.string(),
        email: z.object({
          id: z.string(),
          thread_id: z.string(),
          body_plain: z.string(),
          date: z.iso.datetime(),
          from: z.array(z.object({ email: z.string() })).min(1),
        }),
      })
      .parse(event.payload);
    if (!mailbox?.selfEmail)
      throw new DomainError("CONNECTION_UNAVAILABLE", 422);
    const isSelf = mail.email.from.some(
      (from) => from.email.toLowerCase() === mailbox.selfEmail?.toLowerCase(),
    );
    if (isSelf && !mailbox.sentFolderIds.includes(mail.folder_id)) return null;
    if (!isSelf && !mailbox.inboxFolderIds.includes(mail.folder_id))
      return null;
    return replySchema.parse({
      provider: "unipile",
      accountId: event.account_id,
      messageId: mail.email.id,
      threadId: mail.email.thread_id,
      direction: isSelf ? "outbound" : "inbound",
      channel: "gmail",
      body: mail.email.body_plain,
      occurredAt: mail.email.date,
    });
  }
  return null;
}
export async function ingestReply(db: Database, input: ReplyEvent) {
  const event = replySchema.parse(input);
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(s.connections)
      .where(
        and(
          eq(s.connections.provider, event.provider),
          eq(s.connections.externalAccountId, event.accountId),
          event.connectionId
            ? eq(s.connections.id, event.connectionId)
            : undefined,
        ),
      )
      .limit(2)
      .for("update");
    const connection = candidates.length === 1 ? candidates[0] : undefined;
    if (!connection || !["connected", "demo"].includes(connection.status))
      throw new DomainError("CONNECTION_UNAVAILABLE", 422);
    const [receipt] = await tx
      .insert(s.connectorEvents)
      .values({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        providerEventId: event.messageId,
        payload: event,
      })
      .onConflictDoNothing()
      .returning();
    if (!receipt) {
      const [previous] = await tx
        .select({ status: s.connectorEvents.status })
        .from(s.connectorEvents)
        .where(
          and(
            eq(s.connectorEvents.connectionId, connection.id),
            eq(s.connectorEvents.providerEventId, event.messageId),
          ),
        );
      return { duplicate: true, matched: previous?.status === "processed" };
    }
    const [conversation] = await tx
      .select()
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.organizationId, connection.organizationId),
          eq(s.conversations.connectionId, connection.id),
          eq(s.conversations.externalThreadId, event.threadId),
        ),
      );
    if (!conversation || conversation.channel !== event.channel) {
      await tx
        .update(s.connectorEvents)
        .set({ status: "unmatched" })
        .where(eq(s.connectorEvents.id, receipt.id));
      return { duplicate: false, matched: false };
    }
    const [message] = await tx
      .insert(s.messages)
      .values({
        organizationId: connection.organizationId,
        productId: conversation.productId,
        conversationId: conversation.id,
        connectionId: connection.id,
        providerMessageId: event.messageId,
        direction: event.direction,
        body: event.body,
        occurredAt: new Date(event.occurredAt),
      })
      .onConflictDoNothing()
      .returning();
    const [latest] = await tx
      .select()
      .from(s.messages)
      .where(eq(s.messages.conversationId, conversation.id))
      .orderBy(desc(s.messages.occurredAt), desc(s.messages.createdAt))
      .limit(1);
    if (
      message &&
      latest?.id === message.id &&
      event.direction === "outbound"
    ) {
      const resolved = await tx
        .update(s.actions)
        .set({
          status: "completed",
          approvedHash: null,
          approvedBy: null,
          version: sqIncrement(s.actions.version),
        })
        .where(
          and(
            eq(s.actions.sourceConversationId, conversation.id),
            eq(s.actions.kind, "reply"),
            eq(s.actions.status, "open"),
          ),
        )
        .returning();
      if (resolved.length)
        await tx.insert(s.changeEvents).values(
          resolved.map((action) => ({
            organizationId: action.organizationId,
            productId: action.productId,
            sourceConversationId: conversation.id,
            actorId: connection.ownerId,
            type: "reply.observed_answer",
            entityId: action.id,
          })),
        );
    }
    if (
      !event.historical &&
      message &&
      latest?.id === message.id &&
      event.direction === "inbound"
    ) {
      await tx
        .update(s.enrollments)
        .set({
          status: "paused_reply",
          version: sqIncrement(s.enrollments.version),
        })
        .where(
          and(
            eq(s.enrollments.organizationId, connection.organizationId),
            eq(s.enrollments.relationshipId, conversation.relationshipId),
            eq(s.enrollments.status, "running"),
          ),
        );
      const blockedActions = await tx
        .update(s.actions)
        .set({
          status: "blocked",
          approvedHash: null,
          approvedBy: null,
          version: sqIncrement(s.actions.version),
        })
        .where(
          and(
            eq(s.actions.organizationId, connection.organizationId),
            eq(s.actions.relationshipId, conversation.relationshipId),
            or(
              eq(s.actions.kind, "approval"),
              isNotNull(s.actions.approvedHash),
            ),
            eq(s.actions.status, "open"),
          ),
        )
        .returning();
      if (blockedActions.length)
        await tx.insert(s.changeEvents).values(
          blockedActions.map((action) => ({
            organizationId: action.organizationId,
            productId: action.productId,
            sourceConversationId: action.sourceConversationId,
            actorId: connection.ownerId,
            type: "action.reply_blocked",
            entityId: action.id,
          })),
        );
      const [pendingReply] = await tx
        .select()
        .from(s.actions)
        .where(
          and(
            eq(s.actions.organizationId, connection.organizationId),
            eq(s.actions.sourceConversationId, conversation.id),
            eq(s.actions.kind, "reply"),
            inArray(s.actions.status, ["open", "blocked"]),
          ),
        );
      if (pendingReply) {
        if (pendingReply.status === "open")
          await tx
            .update(s.actions)
            .set({
              approvedHash: null,
              approvedBy: null,
              version: sqIncrement(s.actions.version),
            })
            .where(eq(s.actions.id, pendingReply.id));
      } else
        await tx.insert(s.actions).values({
          organizationId: connection.organizationId,
          productId: conversation.productId,
          relationshipId: conversation.relationshipId,
          sourceConversationId: conversation.id,
          ownerId: conversation.ownerId,
          kind: "reply",
          title: t.newReplyAction,
          reason: t.newReplyReason,
          owedBy: "us",
          channel: conversation.channel,
          dueAt: new Date(),
        });
    }
    await tx
      .update(s.connectorEvents)
      .set({ status: "processed" })
      .where(eq(s.connectorEvents.id, receipt.id));
    if (message)
      await tx.insert(s.changeEvents).values({
        organizationId: connection.organizationId,
        productId: conversation.productId,
        sourceConversationId: conversation.id,
        actorId: connection.ownerId,
        type:
          event.direction === "inbound" ? "reply.received" : "message.observed",
        entityId: message.id,
      });
    return { duplicate: !message, matched: true };
  });
}

import { type AnyColumn, sql } from "drizzle-orm";

const sqIncrement = (column: AnyColumn) => sql`${column}+1`;
