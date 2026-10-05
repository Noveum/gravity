import { saveReceipt } from "@crm/connectors/receipts";
import {
  ingestReply,
  normalizeUnipileV2,
  unipileEnvelope,
  verifyUnipileSignature,
} from "@crm/connectors/replies";
import { IntegrationService } from "@crm/connectors/service";
import { publishChange } from "@crm/core/changes";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { connections } from "@crm/database/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const secret = process.env.UNIPILE_WEBHOOK_SECRET;
    if (!secret || isDemoMode())
      throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    const raw = await limitedBody(request, 200000);
    if (
      !verifyUnipileSignature(
        raw,
        request.headers.get("unipile-signature"),
        secret,
      )
    )
      throw new DomainError("UNAUTHORIZED", 401);
    const payload = JSON.parse(new TextDecoder().decode(raw));
    const event = unipileEnvelope.parse(payload);
    const db = await getDatabase();
    const service = new IntegrationService(db);
    if (["account.add", "account.reconnect"].includes(event.type)) {
      const value = z
        .object({ state: z.string(), account: z.unknown() })
        .parse(event.payload);
      const linked = await service.linkedInAccount(value.state, value.account);
      publishChange(linked.organizationId);
      return Response.json({ received: true });
    }
    const [connection] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.provider, "unipile"),
          eq(connections.externalAccountId, event.account_id),
        ),
      );
    if (!connection) throw new DomainError("CONNECTION_UNAVAILABLE", 422);
    if (
      connection.encryptedCredentials &&
      [
        "account.status.disconnected",
        "account.status.errored",
        "account.remove",
      ].includes(event.type)
    ) {
      await db
        .update(connections)
        .set({ status: "reconnect_required", errorCode: "RECONNECT_REQUIRED" })
        .where(eq(connections.id, connection.id));
      publishChange(connection.organizationId);
      return Response.json({ received: true });
    }
    if (
      event.type === "account.status.running" &&
      connection.encryptedCredentials
    ) {
      await db
        .update(connections)
        .set({ status: "connected", errorCode: null })
        .where(eq(connections.id, connection.id));
      publishChange(connection.organizationId);
      return Response.json({ received: true });
    }
    if (event.type === "message.new" && connection.productId) {
      if (connection.status !== "connected")
        return Response.json({ ignored: true });
      await saveReceipt(
        db,
        connection,
        event.id,
        "unipile",
        z.record(z.string(), z.unknown()).parse(event.payload),
      );
      return Response.json({ received: true });
    }
    const normalized = normalizeUnipileV2(payload, connection);
    if (!normalized) return Response.json({ ignored: true });
    const result = await ingestReply(db, normalized);
    publishChange(connection.organizationId);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
