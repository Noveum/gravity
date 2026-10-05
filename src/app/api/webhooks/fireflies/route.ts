import { saveReceipt } from "@crm/connectors/receipts";
import { unseal, verifyFirefliesSignature } from "@crm/connectors/security";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { connections } from "@crm/database/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    if (isDemoMode()) throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    const id = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("connectionId"));
    const db = await getDatabase();
    const [connection] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.id, id),
          eq(connections.provider, "fireflies"),
          eq(connections.status, "connected"),
        ),
      );
    if (!connection?.webhookSecret || !connection.encryptedCredentials)
      throw new DomainError("UNAUTHORIZED", 401);
    const context = `${connection.organizationId}:${connection.ownerId}:${connection.id}`;
    const raw = await limitedBody(request, 10000);
    if (
      !verifyFirefliesSignature(
        raw,
        request.headers.get("x-hub-signature"),
        unseal<string>(connection.webhookSecret, `${context}:webhook`),
      )
    )
      throw new DomainError("UNAUTHORIZED", 401);
    const event = z
      .object({
        event: z.string(),
        timestamp: z.number(),
        meeting_id: z.string().min(1).max(500),
      })
      .parse(JSON.parse(new TextDecoder().decode(raw)));
    if (!["meeting.transcribed", "meeting.summarized"].includes(event.event))
      return Response.json({ ignored: true });
    await saveReceipt(
      db,
      connection,
      `${event.meeting_id}:${event.event}:${event.timestamp}`,
      "fireflies",
      event,
    );
    return Response.json({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
}
