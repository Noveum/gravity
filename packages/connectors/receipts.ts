import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { publishChange } from "../core/changes";
import { authorize, DomainError } from "../core/policy";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import {
  firefliesQuery,
  normalizeFireflies,
  normalizeLinkedIn,
  type ProviderFetch,
} from "./providers";
import { unseal } from "./security";
import { IntegrationService } from "./service";
import type { ImportRecord, ProviderCredentials } from "./types";

// Only call after verifying the vendor signature against the exact raw body.
// The receipt is committed before acknowledgement; private source data is never logged.
export async function saveReceipt(
  db: Database,
  connection: typeof s.connections.$inferSelect,
  externalId: string,
  provider: "unipile" | "fireflies",
  payload: Record<string, unknown>,
) {
  if (
    !connection.productId ||
    connection.status !== "connected" ||
    !connection.encryptedCredentials
  )
    throw new DomainError("CONNECTION_UNAVAILABLE", 422);
  await db
    .insert(s.integrationReceipts)
    .values({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      externalId: z.string().min(1).max(1000).parse(externalId),
      provider,
      payload,
    })
    .onConflictDoNothing();
}
export async function processReceipts(
  db: Database,
  transport: ProviderFetch = fetch,
) {
  let processed = 0,
    failed = 0;
  for (let count = 0; count < 4; count++) {
    const receipt = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(s.integrationReceipts)
        .where(
          and(
            isNull(s.integrationReceipts.processedAt),
            lt(s.integrationReceipts.attempts, 8),
            lte(s.integrationReceipts.nextAttemptAt, new Date()),
            or(
              isNull(s.integrationReceipts.leaseUntil),
              lt(s.integrationReceipts.leaseUntil, new Date()),
            ),
          ),
        )
        .orderBy(s.integrationReceipts.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;
      const [claimed] = await tx
        .update(s.integrationReceipts)
        .set({
          leaseUntil: new Date(Date.now() + 120000),
          attempts: sql`${s.integrationReceipts.attempts}+1`,
        })
        .where(eq(s.integrationReceipts.id, candidate.id))
        .returning();
      return claimed;
    });
    if (!receipt) break;
    try {
      const [connection] = await db
        .select()
        .from(s.connections)
        .where(
          and(
            eq(s.connections.id, receipt.connectionId),
            eq(s.connections.organizationId, receipt.organizationId),
          ),
        );
      if (
        connection?.status === "connected" &&
        connection.productId &&
        connection.encryptedCredentials
      ) {
        await authorize(
          db,
          { userId: connection.ownerId, source: "session" },
          connection.organizationId,
          connection.productId,
          true,
        );
        let record: ImportRecord | null;
        if (receipt.provider === "unipile")
          record = normalizeLinkedIn(receipt.payload);
        else {
          const credentials = unseal<ProviderCredentials>(
            connection.encryptedCredentials,
            `${connection.organizationId}:${connection.ownerId}:${connection.id}`,
          );
          const result = await firefliesQuery(
            credentials.apiKey ?? "",
            "query($id: String!) { transcript(id: $id) { id title date participants user { user_id } summary { overview action_items } } }",
            { id: z.string().parse(receipt.payload.meeting_id) },
            transport,
          );
          const owner = z
            .object({ user: z.object({ user_id: z.string() }) })
            .parse(result.transcript);
          if (owner.user.user_id !== connection.externalAccountId)
            throw new DomainError("FORBIDDEN", 403);
          record = normalizeFireflies(result.transcript);
        }
        if (record)
          await new IntegrationService(db, transport).importRecord(
            connection,
            record,
          );
        publishChange(connection.organizationId);
      }
      // Disconnects intentionally discard pending deliveries instead of reactivating access.
      await db
        .update(s.integrationReceipts)
        .set({ processedAt: new Date(), leaseUntil: null, errorCode: null })
        .where(eq(s.integrationReceipts.id, receipt.id));
      processed++;
    } catch (error) {
      await db
        .update(s.integrationReceipts)
        .set({
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600000, 30000 * 2 ** receipt.attempts),
          ),
          errorCode:
            error instanceof DomainError
              ? error.code
              : "PROVIDER_RESPONSE_INVALID",
        })
        .where(eq(s.integrationReceipts.id, receipt.id));
      failed++;
    }
  }
  return { processed, failed };
}
