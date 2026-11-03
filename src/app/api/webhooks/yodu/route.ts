import { YoduService } from "@crm/connectors/yodu";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    if (isDemoMode()) throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
    const sourceId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("sourceId"));
    const raw = await limitedBody(request, 10000);
    return Response.json(
      await new YoduService(await getDatabase()).ingest(
        sourceId,
        raw,
        request.headers.get("yodu-signature"),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
