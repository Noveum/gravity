import { appUrl } from "@crm/auth/options";
import { currentPrincipal } from "@crm/auth/server";
import { IntegrationService } from "@crm/connectors/service";
import { DomainError } from "@crm/core/policy";
import { getDatabase } from "@crm/database/client";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const target = new URL("/", appUrl());
  target.searchParams.set("view", "connections");
  try {
    const principal = await currentPrincipal(request.headers);
    const query = new URL(request.url).searchParams;
    if (query.has("error_type"))
      throw new DomainError("PROVIDER_PERMISSION", 400);
    const result = await new IntegrationService(
      await getDatabase(),
    ).linkedInCallback(
      principal,
      z.string().max(200).parse(query.get("state")),
    );
    target.searchParams.set("organizationId", result.organizationId);
    target.searchParams.set("productId", result.productId);
    target.searchParams.set(
      "integration",
      result.pending ? "pending" : "connected",
    );
  } catch (error) {
    target.searchParams.set(
      "integrationError",
      error instanceof DomainError ? error.code : "PROVIDER_RESPONSE_INVALID",
    );
  }
  return Response.redirect(target, 303);
}
