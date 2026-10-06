import { unipileCredentials } from "@crm/connectors/configuration";
import { saveReceipt } from "@crm/connectors/receipts";
import {
  ingestReply,
  normalizeUnipileV2,
  unipileEnvelope,
  verifyUnipileSignature,
} from "@crm/connectors/replies";
import { IntegrationService } from "@crm/connectors/service";
import {
  unipileV1Envelope,
  verifyUnipileV1Authorization,
} from "@crm/connectors/unipile-v1";
import { publishChange } from "@crm/core/changes";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { connections, providerConfigurations } from "@crm/database/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (isDemoMode()) throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    const configurationId = z
      .uuid()
      .safeParse(new URL(request.url).searchParams.get("configurationId"));
    if (!configurationId.success) throw new DomainError("UNAUTHORIZED", 401);
    const db = await getDatabase();
    const [configuration] = await db
      .select()
      .from(providerConfigurations)
      .where(
        and(
          eq(providerConfigurations.id, configurationId.data),
          eq(providerConfigurations.active, true),
        ),
      );
    if (!configuration) throw new DomainError("UNAUTHORIZED", 401);
    const credentials = unipileCredentials(configuration);
    const secret = credentials.signingSecret;
    if (
      !secret ||
      (credentials.apiVersion !== "v1" && !configuration.webhookReady)
    )
      throw new DomainError("UNAUTHORIZED", 401);
    const raw = await limitedBody(request, 200000);
    if (
      !(credentials.apiVersion === "v1"
        ? verifyUnipileV1Authorization(
            request.headers.get("authorization"),
            secret,
          )
        : verifyUnipileSignature(
            raw,
            request.headers.get("unipile-signature"),
            secret,
          ))
    )
      throw new DomainError("UNAUTHORIZED", 401);
    const payload = JSON.parse(new TextDecoder().decode(raw));
    const event =
      credentials.apiVersion === "v1"
        ? unipileV1Envelope(payload)
        : unipileEnvelope.parse(payload);
    const service = new IntegrationService(db);
    if (["account.add", "account.reconnect"].includes(event.type)) {
      const value = z
        .object({ state: z.string(), account: z.unknown() })
        .parse(event.payload);
      const linked = await service.linkedInAccount(
        value.state,
        value.account,
        configuration.id,
      );
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
          eq(connections.providerConfigurationId, configuration.id),
        ),
      );
    if (!connection) throw new DomainError("CONNECTION_UNAVAILABLE", 422);
    if (
      credentials.apiVersion === "v1" &&
      ["account.status.errored", "account.status.permission"].includes(
        event.type,
      ) &&
      connection.encryptedCredentials
    ) {
      await db
        .update(connections)
        .set({
          errorCode:
            event.type === "account.status.permission"
              ? "PROVIDER_PERMISSION"
              : "PROVIDER_UNAVAILABLE",
        })
        .where(
          and(
            eq(connections.id, connection.id),
            isNotNull(connections.encryptedCredentials),
          ),
        );
      publishChange(connection.organizationId);
      return Response.json({ received: true });
    }
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
        .where(
          and(
            eq(connections.id, connection.id),
            isNotNull(connections.encryptedCredentials),
          ),
        );
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
        .where(
          and(
            eq(connections.id, connection.id),
            isNotNull(connections.encryptedCredentials),
          ),
        );
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
    const normalized = normalizeUnipileV2(event, connection);
    if (!normalized) return Response.json({ ignored: true });
    const result = await ingestReply(db, {
      ...normalized,
      connectionId: connection.id,
    });
    publishChange(connection.organizationId);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
