import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { contactIdentityIds, lockContactDirectory } from "./contact-history";
import { scopeSchema } from "./crm";
import { preciseInstantSchema } from "./datetime";
import { draftHash, draftSubject } from "./drafts";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import { assertActiveRelationships, clearApprovals } from "./visibility";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const channel = z.enum(["gmail", "linkedin"]);
const sourceId = z.string().trim().min(1).max(500);
const version = z.number().int().positive();
// Share one serialized-byte budget across HTTP and MCP, with room for the
// operation envelope below the HTTP adapter's 100,000-byte body limit.
const fitsNativeInput = (input: object) =>
  Buffer.byteLength(JSON.stringify(input), "utf8") <= 90000;
export const nativeDraftListSchema = scopeSchema.extend({
  relationshipId: z.uuid(),
});
export const listNativeDraftsSchema = nativeDraftListSchema.extend({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const draftCursorSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
export const ingestHistorySchema = nativeDraftListSchema
  .extend({
    channel,
    sourceThreadId: sourceId,
    messages: z
      .array(
        z.object({
          sourceMessageId: sourceId,
          direction: z.enum(["inbound", "outbound"]),
          body: z.string().min(1).max(60000),
          occurredAt: preciseInstantSchema,
        }),
      )
      .min(1)
      .max(30)
      .refine(
        (items) =>
          new Set(items.map((item) => item.sourceMessageId)).size ===
          items.length,
      )
      .refine(
        (items) =>
          items.reduce((length, item) => length + item.body.length, 0) <= 60000,
      ),
  })
  .refine(fitsNativeInput);
const draftFields = {
  channel,
  title: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(10000).default(""),
  body: z.string().min(1).max(20000),
};
export const ingestDraftSchema = nativeDraftListSchema
  .extend({
    ...draftFields,
    sourceId,
  })
  .refine(fitsNativeInput);
export const editNativeDraftSchema = scopeSchema
  .extend({
    draftId: z.uuid(),
    version,
    ...draftFields,
  })
  .refine(fitsNativeInput);
export const scheduleNativeDraftSchema = scopeSchema.extend({
  draftId: z.uuid(),
  version,
  dueAt: preciseInstantSchema,
});

function writeActor(principal: Principal) {
  if (principal.source === "mcp" && principal.readOnly !== false)
    throw new DomainError("HUMAN_ACTION_REQUIRED", 403);
}

export class NativeIngestionService {
  constructor(
    private db: Database,
    private clock = Date.now,
  ) {}

  private async relationship(
    db: Database | Transaction,
    principal: Principal,
    input: z.infer<typeof nativeDraftListSchema>,
    write = false,
  ) {
    const [relationship] = await db
      .select()
      .from(s.relationships)
      .where(
        and(
          eq(s.relationships.id, input.relationshipId),
          eq(s.relationships.organizationId, input.organizationId),
        ),
      );
    if (!relationship) throw new DomainError("NOT_FOUND", 404);
    await authorize(
      db,
      principal,
      input.organizationId,
      relationship.productId,
      write,
    );
    if (input.productId && input.productId !== relationship.productId)
      throw new DomainError("FORBIDDEN", 403);
    if (!write && principal.source === "mcp" && principal.readOnly !== false) {
      const [person] = await db
        .select({ archivedAt: s.people.archivedAt })
        .from(s.people)
        .where(
          and(
            eq(s.people.id, relationship.personId),
            eq(s.people.organizationId, input.organizationId),
          ),
        );
      if (person?.archivedAt) throw new DomainError("NOT_FOUND", 404);
    }
    if (write) {
      await lockContactDirectory(db, input.organizationId);
      // Serialize history changes with the send claim's person lock.
      const [person] = await db
        .select()
        .from(s.people)
        .where(eq(s.people.id, relationship.personId));
      const identities = await contactIdentityIds(
        db,
        input.organizationId,
        person,
      );
      await db
        .select({ id: s.people.id })
        .from(s.people)
        .where(
          and(
            eq(s.people.organizationId, input.organizationId),
            inArray(s.people.id, identities),
          ),
        )
        .orderBy(asc(s.people.id))
        .for("update");
      await assertActiveRelationships(db, input.organizationId, [
        relationship.id,
      ]);
      await assertProductActive(
        db as Transaction,
        input.organizationId,
        relationship.productId,
      );
      await authorize(
        db,
        principal,
        input.organizationId,
        relationship.productId,
        true,
      );
    }
    return relationship;
  }

  private async thread(
    tx: Transaction,
    principal: Principal,
    relationship: typeof s.relationships.$inferSelect,
    channel: "gmail" | "linkedin",
    key: string,
  ) {
    const [created] = await tx
      .insert(s.conversations)
      .values({
        organizationId: relationship.organizationId,
        productId: relationship.productId,
        relationshipId: relationship.id,
        ownerId: principal.userId,
        connectionId: null,
        provenance: "native",
        externalThreadId: key,
        channel,
        visibility: "private",
      })
      .onConflictDoNothing()
      .returning();
    const [existing] = created
      ? [created]
      : await tx
          .select()
          .from(s.conversations)
          .where(
            and(
              eq(s.conversations.organizationId, relationship.organizationId),
              eq(s.conversations.ownerId, principal.userId),
              eq(s.conversations.provenance, "native"),
              eq(s.conversations.channel, channel),
              eq(s.conversations.externalThreadId, key),
            ),
          );
    if (
      !existing ||
      existing.productId !== relationship.productId ||
      existing.relationshipId !== relationship.id
    )
      throw new DomainError("INGESTION_CONFLICT", 409);
    return existing;
  }

  async history(
    principal: Principal,
    input: z.infer<typeof ingestHistorySchema>,
  ) {
    writeActor(principal);
    input = ingestHistorySchema.parse(input);
    if (
      input.messages.some(
        (message) => Date.parse(message.occurredAt) > this.clock(),
      )
    )
      throw new DomainError("HISTORY_FUTURE", 400);
    return this.db.transaction(async (tx) => {
      const relationship = await this.relationship(tx, principal, input, true);
      const conversation = await this.thread(
        tx,
        principal,
        relationship,
        input.channel,
        `history:${input.sourceThreadId}`,
      );
      const messageIds: string[] = [];
      let created = 0;
      for (const item of input.messages) {
        const [message] = await tx
          .insert(s.messages)
          .values({
            organizationId: input.organizationId,
            productId: relationship.productId,
            conversationId: conversation.id,
            connectionId: null,
            providerMessageId: item.sourceMessageId,
            direction: item.direction,
            body: item.body,
            occurredAt: new Date(item.occurredAt),
          })
          .onConflictDoNothing()
          .returning();
        const [stored] = message
          ? [message]
          : await tx
              .select()
              .from(s.messages)
              .where(
                and(
                  eq(s.messages.conversationId, conversation.id),
                  eq(s.messages.providerMessageId, item.sourceMessageId),
                ),
              );
        if (
          !stored ||
          stored.body !== item.body ||
          stored.direction !== item.direction ||
          stored.occurredAt.getTime() !== Date.parse(item.occurredAt)
        )
          throw new DomainError("INGESTION_CONFLICT", 409);
        messageIds.push(stored.id);
        if (!message) continue;
        created++;
        const last =
          item.direction === "outbound"
            ? s.relationships.lastOutboundAt
            : s.relationships.lastInboundAt;
        await tx
          .update(s.relationships)
          .set({
            [item.direction === "outbound"
              ? "lastOutboundAt"
              : "lastInboundAt"]:
              sql`greatest(coalesce(${last}, ${item.occurredAt}::timestamptz), ${item.occurredAt}::timestamptz)`,
          })
          .where(eq(s.relationships.id, relationship.id));
        await tx.insert(s.changeEvents).values({
          organizationId: input.organizationId,
          productId: relationship.productId,
          sourceConversationId: conversation.id,
          actorId: principal.userId,
          type: "message.imported",
          entityId: stored.id,
        });
      }
      if (created) {
        const [person] = await tx
          .select()
          .from(s.people)
          .where(eq(s.people.id, relationship.personId));
        for (const personId of await contactIdentityIds(
          tx,
          input.organizationId,
          person,
        ))
          await clearApprovals(tx, principal, input.organizationId, personId);
      }
      return {
        conversationId: conversation.id,
        messageIds,
        created,
        visibility: conversation.visibility,
      };
    });
  }

  async drafts(
    principal: Principal,
    input: z.input<typeof listNativeDraftsSchema>,
  ) {
    const value = listNativeDraftsSchema.parse(input);
    const relationship = await this.relationship(this.db, principal, value);
    let cursor: z.infer<typeof draftCursorSchema> | undefined;
    if (value.cursor) {
      try {
        cursor = draftCursorSchema.parse(JSON.parse(value.cursor));
      } catch {
        throw new DomainError("INVALID_INPUT", 400);
      }
    }
    const rows = await this.db
      .select({
        ...getTableColumns(s.nativeDrafts),
        cursorCreatedAt: sql<string>`to_char(${s.nativeDrafts.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(s.nativeDrafts)
      .where(
        and(
          eq(s.nativeDrafts.organizationId, value.organizationId),
          eq(s.nativeDrafts.productId, relationship.productId),
          eq(s.nativeDrafts.relationshipId, relationship.id),
          eq(s.nativeDrafts.ownerId, principal.userId),
          cursor
            ? or(
                sql`${s.nativeDrafts.createdAt} > ${cursor.createdAt}::timestamptz`,
                and(
                  sql`${s.nativeDrafts.createdAt} = ${cursor.createdAt}::timestamptz`,
                  gt(s.nativeDrafts.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(s.nativeDrafts.createdAt), asc(s.nativeDrafts.id))
      .limit(value.limit + 1);
    const page = rows.slice(0, value.limit);
    const last = page.at(-1);
    return {
      items: page.map(
        ({ cursorCreatedAt: _cursorCreatedAt, ...draft }) => draft,
      ),
      nextCursor:
        rows.length > value.limit && last
          ? JSON.stringify({ createdAt: last.cursorCreatedAt, id: last.id })
          : null,
    };
  }

  async draft(principal: Principal, input: z.infer<typeof ingestDraftSchema>) {
    writeActor(principal);
    input = ingestDraftSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const relationship = await this.relationship(tx, principal, input, true);
      const conversation = await this.thread(
        tx,
        principal,
        relationship,
        input.channel,
        `draft:${input.sourceId}`,
      );
      const sourceHash = createHash("sha256")
        .update(
          JSON.stringify({
            relationshipId: relationship.id,
            channel: input.channel,
            title: input.title,
            reason: input.reason,
            body: input.body,
          }),
        )
        .digest("hex");
      const [created] = await tx
        .insert(s.nativeDrafts)
        .values({
          organizationId: input.organizationId,
          productId: relationship.productId,
          relationshipId: relationship.id,
          ownerId: principal.userId,
          sourceConversationId: conversation.id,
          channel: input.channel,
          sourceId: input.sourceId,
          sourceHash,
          title: input.title,
          reason: input.reason,
          body: input.body,
        })
        .onConflictDoNothing()
        .returning();
      const [stored] = created
        ? [created]
        : await tx
            .select()
            .from(s.nativeDrafts)
            .where(
              and(
                eq(s.nativeDrafts.organizationId, input.organizationId),
                eq(s.nativeDrafts.ownerId, principal.userId),
                eq(s.nativeDrafts.sourceId, input.sourceId),
              ),
            );
      if (
        !stored ||
        stored.productId !== relationship.productId ||
        stored.relationshipId !== relationship.id ||
        stored.sourceHash !== sourceHash
      )
        throw new DomainError("INGESTION_CONFLICT", 409);
      if (created)
        await tx.insert(s.changeEvents).values({
          organizationId: input.organizationId,
          productId: relationship.productId,
          sourceConversationId: conversation.id,
          actorId: principal.userId,
          type: "draft.imported",
          entityId: stored.id,
        });
      return stored;
    });
  }

  private async owned(
    tx: Transaction,
    principal: Principal,
    input: z.infer<typeof scopeSchema> & { draftId: string },
  ) {
    const [found] = await tx
      .select()
      .from(s.nativeDrafts)
      .where(
        and(
          eq(s.nativeDrafts.id, input.draftId),
          eq(s.nativeDrafts.organizationId, input.organizationId),
          eq(s.nativeDrafts.ownerId, principal.userId),
        ),
      );
    if (!found) throw new DomainError("NOT_FOUND", 404);
    const relationship = await this.relationship(
      tx,
      principal,
      { ...input, relationshipId: found.relationshipId },
      true,
    );
    const [draft] = await tx
      .select()
      .from(s.nativeDrafts)
      .where(eq(s.nativeDrafts.id, found.id))
      .for("update");
    if (!draft) throw new DomainError("NOT_FOUND", 404);
    return { draft, relationship };
  }

  async edit(
    principal: Principal,
    input: z.infer<typeof editNativeDraftSchema>,
  ) {
    writeActor(principal);
    input = editNativeDraftSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const { draft } = await this.owned(tx, principal, input);
      if (draft.scheduledActionId)
        throw new DomainError("DRAFT_ALREADY_SCHEDULED", 409);
      if (draft.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      // Channel changes need a distinct private source thread, so disallow silent retargeting.
      if (draft.channel !== input.channel)
        throw new DomainError("CHANNEL_MISMATCH", 422);
      const [result] = await tx
        .update(s.nativeDrafts)
        .set({
          title: input.title,
          reason: input.reason,
          body: input.body,
          version: draft.version + 1,
        })
        .where(eq(s.nativeDrafts.id, draft.id))
        .returning();
      await tx.insert(s.changeEvents).values({
        organizationId: draft.organizationId,
        productId: draft.productId,
        sourceConversationId: draft.sourceConversationId,
        actorId: principal.userId,
        type: "draft.edited",
        entityId: draft.id,
      });
      return result;
    });
  }

  async schedule(
    principal: Principal,
    input: z.infer<typeof scheduleNativeDraftSchema>,
  ) {
    writeActor(principal);
    input = scheduleNativeDraftSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const { draft, relationship } = await this.owned(tx, principal, input);
      if (draft.scheduledActionId) {
        const [action] = await tx
          .select()
          .from(s.actions)
          .where(eq(s.actions.id, draft.scheduledActionId));
        if (action?.dueAt.getTime() !== Date.parse(input.dueAt))
          throw new DomainError("INGESTION_CONFLICT", 409);
        return {
          actionId: draft.scheduledActionId,
          draftId: draft.id,
          version: draft.version,
        };
      }
      if (draft.version !== input.version)
        throw new DomainError("CONFLICT", 409);
      const [person] = await tx
        .select()
        .from(s.people)
        .where(eq(s.people.id, relationship.personId));
      const hash = draftHash({
        draft: draft.body,
        ...(await draftSubject(tx, person)),
        channel: draft.channel,
        productId: draft.productId,
      });
      const [action] = await tx
        .insert(s.actions)
        .values({
          organizationId: draft.organizationId,
          productId: draft.productId,
          relationshipId: draft.relationshipId,
          ownerId: principal.userId,
          sourceConversationId: draft.sourceConversationId,
          kind: "reply",
          owedBy: "us",
          channel: draft.channel,
          title: draft.title,
          reason: draft.reason,
          draft: draft.body,
          draftHash: hash,
          dueAt: new Date(input.dueAt),
          status: "open",
          approvedHash: null,
          approvedBy: null,
        })
        .returning();
      await tx
        .update(s.nativeDrafts)
        .set({ scheduledActionId: action.id, version: draft.version + 1 })
        .where(eq(s.nativeDrafts.id, draft.id));
      await tx.insert(s.changeEvents).values({
        organizationId: draft.organizationId,
        productId: draft.productId,
        sourceConversationId: draft.sourceConversationId,
        actorId: principal.userId,
        type: "draft.scheduled",
        entityId: action.id,
      });
      return {
        actionId: action.id,
        draftId: draft.id,
        version: draft.version + 1,
      };
    });
  }
}
