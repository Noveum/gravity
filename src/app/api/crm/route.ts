import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { errorResponse, limitedBody } from "@crm/core/http";
import { getDatabase } from "@crm/database/client";
import { apiOperation } from "@crm/operations/catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
// An explicit coding preference overrides the wildcard, including gzip;q=0.
function snapshotEncoding(acceptEncoding: string | null, byteLength: number) {
  const quality = new Map<string, number>();
  for (const value of (acceptEncoding ?? "").toLowerCase().split(",")) {
    const entry =
      /^(gzip|identity|\*)\s*(?:;\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/.exec(
        value.trim(),
      );
    if (entry) quality.set(entry[1], Number(entry[2] ?? 1));
  }
  const gzip = quality.get("gzip") ?? quality.get("*") ?? 0;
  const identity = quality.get("identity");
  const canSendIdentity = (identity ?? (quality.get("*") === 0 ? 0 : 1)) > 0;
  if (
    gzip > 0 &&
    (!canSendIdentity || (byteLength >= 64 * 1024 && gzip >= (identity ?? 0)))
  )
    return "gzip";
  return canSendIdentity ? "identity" : null;
}

// Stream the authorized snapshot so large workspaces can load through a
// function host's buffered-response limit. Keep the same JSON wire format.
function snapshotResponse(snapshot: unknown, acceptEncoding: string | null) {
  const bytes = Buffer.from(JSON.stringify(snapshot));
  const encoding = snapshotEncoding(acceptEncoding, bytes.length);
  if (!encoding)
    return new Response(null, {
      status: 406,
      headers: { ...headers, Vary: "Accept-Encoding" },
    });
  let offset = 0;
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      const chunk = bytes.subarray(offset, offset + 64 * 1024);
      controller.enqueue(chunk);
      offset += chunk.length;
      if (offset === bytes.length) controller.close();
    },
  });
  const responseHeaders = new Headers({
    ...headers,
    "Content-Type": "application/json",
    Vary: "Accept-Encoding",
  });
  if (encoding === "gzip") {
    responseHeaders.set("Content-Encoding", "gzip");
    return new Response(body.pipeThrough(new CompressionStream("gzip")), {
      headers: responseHeaders,
    });
  }
  return new Response(body, { headers: responseHeaders });
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
      ? snapshotResponse(result, request.headers.get("accept-encoding"))
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
