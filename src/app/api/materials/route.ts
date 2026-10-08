import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { readLocalObject } from "@crm/files/storage";
import { apiOperation } from "@crm/operations/catalog";
import { maxFileSize } from "@crm/storage/files";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await currentPrincipal(request.headers);
    const fields = z
      .object({ organizationId: z.uuid(), assetId: z.uuid() })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const asset = (await apiOperation("materials", "GET", "download").execute(
      { db: await getDatabase(), principal },
      fields,
    )) as {
      assetId: string;
      name: string;
      version: number;
      mimeType: string;
      size: number;
      sha256: string;
      url: string;
    };
    if (!asset.url.startsWith("local:")) {
      return new Response(null, {
        status: 307,
        headers: {
          Location: asset.url,
          "Cache-Control": "private, no-store",
        },
      });
    }
    const bytes = await readLocalObject(asset.url.slice(6));
    return new Response(bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const raw = await limitedBody(request, 4 * 1024 * 1024);
    const input = z
      .object({})
      .passthrough()
      .parse(JSON.parse(new TextDecoder().decode(raw)));
    const operation = z
      .string()
      .parse(
        new URL(request.url).searchParams.get("operation") ?? input.operation,
      );
    const result = await apiOperation("materials", "POST", operation).execute(
      { db: await getDatabase(), principal },
      input,
    );
    return Response.json(result, {
      status: operation === "reserve" ? 201 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isDemoMode()) throw new DomainError("FORBIDDEN", 403);
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const fields = Object.fromEntries(new URL(request.url).searchParams);
    const bytes = await limitedBody(request, maxFileSize);
    const result = await apiOperation("materials", "POST", "upload-bytes").execute(
      { db: await getDatabase(), principal },
      { ...fields, dataBase64: Buffer.from(bytes).toString("base64") },
    );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
