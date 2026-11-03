import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import {
  messageHistoryCursor,
  messageHistoryCursorTimestamp,
} from "./contact-history";
import { scopeSchema } from "./crm";
import { cursorInstantSchema } from "./datetime";
import { authorize, DomainError, type Principal } from "./policy";

export const messageHistorySchema = scopeSchema.extend({
  relationshipId: z.uuid(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const cursorSchema = z.strictObject({
  occurredAt: cursorInstantSchema,
  id: z.uuid(),
});

export class MessageHistoryService {
  constructor(private db: Database) {}

  async page(
    principal: Principal,
    input: z.input<typeof messageHistorySchema>,
  ) {
    const value = messageHistorySchema.parse(input);
    const [relationship] = await this.db
      .select()
      .from(s.relationships)
      .where(
        and(
          eq(s.relationships.organizationId, value.organizationId),
          eq(s.relationships.id, value.relationshipId),
        ),
      );
    if (!relationship) throw new DomainError("NOT_FOUND", 404);
    await authorize(
      this.db,
      principal,
      value.organizationId,
      relationship.productId,
    );
    if (value.productId && value.productId !== relationship.productId)
      throw new DomainError("FORBIDDEN", 403);
    const [person] = await this.db
      .select({ archivedAt: s.people.archivedAt })
      .from(s.people)
      .where(
        and(
          eq(s.people.organizationId, value.organizationId),
          eq(s.people.id, relationship.personId),
        ),
      );
    if (
      person?.archivedAt &&
      principal.source === "mcp" &&
      principal.readOnly !== false
    )
      throw new DomainError("NOT_FOUND", 404);
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (value.cursor) {
      try {
        cursor = cursorSchema.parse(JSON.parse(value.cursor));
      } catch {
        throw new DomainError("INVALID_INPUT", 400);
      }
    }
    const items = await this.db
      .select({
        id: s.messages.id,
        conversationId: s.messages.conversationId,
        direction: s.messages.direction,
        body: s.messages.body,
        occurredAt: s.messages.occurredAt,
        cursorOccurredAt: messageHistoryCursorTimestamp,
        providerMessageId: s.messages.providerMessageId,
        provenance: s.conversations.provenance,
        channel: s.conversations.channel,
      })
      .from(s.messages)
      .innerJoin(
        s.conversations,
        eq(s.conversations.id, s.messages.conversationId),
      )
      .where(
        and(
          eq(s.messages.organizationId, value.organizationId),
          eq(s.messages.productId, relationship.productId),
          eq(s.conversations.organizationId, value.organizationId),
          eq(s.conversations.productId, relationship.productId),
          eq(s.conversations.relationshipId, relationship.id),
          or(
            eq(s.conversations.ownerId, principal.userId),
            eq(s.conversations.visibility, "product"),
          ),
          cursor
            ? sql`(${s.messages.occurredAt}, ${s.messages.id}) < (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(s.messages.occurredAt), desc(s.messages.id))
      .limit(value.limit + 1);
    const messages = items.slice(0, value.limit);
    const last = messages.at(-1);
    return {
      messages: messages.map(
        ({ cursorOccurredAt: _cursorOccurredAt, ...message }) => message,
      ),
      nextCursor:
        items.length > value.limit ? messageHistoryCursor(last) : null,
      accessibleHistoryOnly: true,
    };
  }
}
