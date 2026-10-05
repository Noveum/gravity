import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import {
  connectInput,
  IntegrationService,
  integrationOverviewInput,
  integrationScope,
} from "@crm/connectors/service";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    if (isDemoMode()) throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    const principal = await currentPrincipal(request.headers);
    const scope = integrationOverviewInput.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(
      await new IntegrationService(await getDatabase()).overview(
        principal,
        scope,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    if (isDemoMode()) throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    const principal = await currentPrincipal(request.headers);
    const body = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 5000)),
    );
    const operation = z
      .enum(["connect", "sync", "disconnect", "link", "ignore"])
      .parse(body.operation);
    const service = new IntegrationService(await getDatabase());
    let result: unknown;
    if (operation === "connect")
      result = await service.connect(principal, connectInput.parse(body));
    else {
      const { organizationId } = integrationScope.parse(body);
      if (operation === "link" || operation === "ignore")
        result = await service.link(
          principal,
          organizationId,
          z.uuid().parse(body.itemId),
          operation === "link"
            ? z.uuid().parse(body.relationshipId)
            : undefined,
        );
      else if (operation === "sync")
        result = await service.sync(
          principal,
          organizationId,
          z.uuid().parse(body.connectionId),
        );
      else
        result = await service.disconnect(
          principal,
          organizationId,
          z.uuid().parse(body.connectionId),
        );
    }
    return Response.json(result ?? { ok: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
