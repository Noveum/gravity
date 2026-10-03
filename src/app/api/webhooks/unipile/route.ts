import {
  ingestReply,
  normalizeUnipileV2,
  unipileEnvelope,
  verifyUnipileSignature,
} from "@crm/connectors/replies";
import { publishChange } from "@crm/core/changes";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { connections } from "@crm/database/schema";
import { and, eq } from "drizzle-orm";
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
    const normalized = normalizeUnipileV2(payload, connection);
    if (!normalized) return Response.json({ ignored: true });
    const result = await ingestReply(db, normalized);
    publishChange(connection.organizationId);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
