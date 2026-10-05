import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { errorResponse, limitedBody } from "@crm/core/http";
import { getDatabase } from "@crm/database/client";
import { apiOperation } from "@crm/operations/catalog";
export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const principal = await currentPrincipal(request.headers);
    const input = Object.fromEntries(new URL(request.url).searchParams);
    const operation = apiOperation("outreach", "GET", input.operation);
    return Response.json(
      await operation.execute({ db: await getDatabase(), principal }, input),
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const input = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 100000)),
    );
    const operation = apiOperation("outreach", "POST", input.operation);
    return Response.json(
      await operation.execute({ db: await getDatabase(), principal }, input),
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
