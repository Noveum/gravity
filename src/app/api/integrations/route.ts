import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { errorResponse, limitedBody } from "@crm/core/http";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { apiOperation } from "@crm/operations/catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

import { DomainError } from "@crm/core/policy";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    if (isDemoMode()) throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    const principal = await currentPrincipal(request.headers);
    const input = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json(
      await apiOperation("integrations", "GET", input.operation).execute(
        { db: await getDatabase(), principal },
        input,
      ),
      { headers },
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
    const input = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 5000)),
    );
    const operation = apiOperation("integrations", "POST", input.operation);
    return Response.json(
      await operation.execute({ db: await getDatabase(), principal }, input),
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
