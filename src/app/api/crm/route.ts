import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { errorResponse, limitedBody } from "@crm/core/http";
import { getDatabase } from "@crm/database/client";
import { apiOperation } from "@crm/operations/catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
// Stream the authorized snapshot so large workspaces can load through a
// function host's buffered-response limit. Keep the same JSON wire format.
function snapshotResponse(snapshot: unknown) {
  const bytes = Buffer.from(JSON.stringify(snapshot));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = bytes.subarray(offset, offset + 64 * 1024);
      controller.enqueue(chunk);
      offset += chunk.length;
      if (offset === bytes.length) controller.close();
    },
  });
  return new Response(body, {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
export async function GET(request: Request) {
  try {
    const principal = await currentPrincipal(request.headers);
    const input = Object.fromEntries(new URL(request.url).searchParams);
    const operation = apiOperation("crm", "GET", input.operation);
    const result = await operation.execute(
      { db: await getDatabase(), principal },
      input,
    );
    return operation.name === "get_workspace" && input.compact === "true"
      ? snapshotResponse(result)
      : Response.json(result, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const input = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 2000000)),
    );
    const operation = apiOperation("crm", "POST", input.operation);
    return Response.json(
      await operation.execute({ db: await getDatabase(), principal }, input),
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
