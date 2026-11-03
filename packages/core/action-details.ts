import { and, asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { contactIdentityIds, lockContactDirectory } from "./contact-history";
import { scopeSchema } from "./crm";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import { assertActiveRelationships } from "./visibility";

export const actionDetailsSchema = scopeSchema.extend({
  actionId: z.uuid(),
  version: z.number().int().positive(),
  reason: z.string().trim().max(10000),
});

export class ActionDetailsService {
  constructor(private db: Database) {}

  async save(principal: Principal, input: z.input<typeof actionDetailsSchema>) {
    const value = actionDetailsSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const row = () =>
        tx
          .select()
          .from(s.actions)
          .where(
            and(
              eq(s.actions.id, value.actionId),
              eq(s.actions.organizationId, value.organizationId),
            ),
          );
      const [found] = await row();
      if (!found) throw new DomainError("NOT_FOUND", 404);
      await authorize(
        tx,
        principal,
        value.organizationId,
        found.productId,
        true,
      );
      if (value.productId && value.productId !== found.productId)
        throw new DomainError("FORBIDDEN", 403);
      // History ingestion and dispatch claims lock identities before conversations
      // and actions. Keep that order while waiting to authorize the current source.
      await lockContactDirectory(tx, value.organizationId);
      const [subject] = await tx
        .select({ person: getTableColumns(s.people) })
        .from(s.relationships)
        .innerJoin(
          s.people,
          and(
            eq(s.people.id, s.relationships.personId),
            eq(s.people.organizationId, s.relationships.organizationId),
          ),
        )
        .where(
          and(
            eq(s.relationships.id, found.relationshipId),
            eq(s.relationships.organizationId, value.organizationId),
            eq(s.relationships.productId, found.productId),
          ),
        );
      if (!subject) throw new DomainError("NOT_FOUND", 404);
      const identities = await contactIdentityIds(
        tx,
        value.organizationId,
        subject.person,
      );
      await tx
        .select({ id: s.people.id })
        .from(s.people)
        .where(
          and(
            eq(s.people.organizationId, value.organizationId),
            inArray(s.people.id, identities),
          ),
        )
        .orderBy(asc(s.people.id))
        .for("update");
      await assertActiveRelationships(tx, value.organizationId, [
        found.relationshipId,
      ]);
      await assertProductActive(tx, value.organizationId, found.productId);
      if (found.sourceConversationId) {
        const [source] = await tx
          .select()
          .from(s.conversations)
          .where(
            and(
              eq(s.conversations.id, found.sourceConversationId),
              eq(s.conversations.organizationId, value.organizationId),
              eq(s.conversations.productId, found.productId),
            ),
          )
          .for("share");
        if (
          !source ||
          (source.visibility === "private" &&
            source.ownerId !== principal.userId)
        )
          throw new DomainError("FORBIDDEN", 403);
      }
      const [action] = await row().for("update");
      // Access can change while a lock is pending. The directory/source locks
      // now hold membership grants and thread visibility stable through commit.
      await authorize(
        tx,
        principal,
        value.organizationId,
        found.productId,
        true,
      );
      if (!action || action.version !== value.version)
        throw new DomainError("CONFLICT", 409);
      const [dispatch] = await tx
        .select({ id: s.deliveries.id })
        .from(s.deliveries)
        .where(
          and(
            eq(s.deliveries.organizationId, value.organizationId),
            eq(s.deliveries.actionId, action.id),
            inArray(s.deliveries.status, ["sending", "unknown", "accepted"]),
          ),
        );
      if (dispatch) throw new DomainError("DELIVERY_IN_PROGRESS", 409);
      if (action.reason === value.reason) return action;
      const [saved] = await tx
        .update(s.actions)
        .set({
          reason: value.reason,
          // Keep the original import/prose verbatim for deliberate review.
          reasonSource: action.reasonSource ?? (action.reason || null),
          approvedHash: null,
          approvedBy: null,
          version: action.version + 1,
        })
        .where(
          and(
            eq(s.actions.id, action.id),
            eq(s.actions.version, value.version),
          ),
        )
        .returning();
      if (!saved) throw new DomainError("CONFLICT", 409);
      await tx.insert(s.changeEvents).values({
        organizationId: action.organizationId,
        productId: action.productId,
        sourceConversationId: action.sourceConversationId,
        actorId: principal.userId,
        type: "action.details_changed",
        entityId: action.id,
      });
      return saved;
    });
  }
}
