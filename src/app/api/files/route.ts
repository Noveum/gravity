import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { readLocalObject } from "@crm/files/storage";
import { MAX_UPLOAD_BYTES } from "@crm/files/validators";
import { apiOperation } from "@crm/operations/catalog";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const downloadSchema = z.object({
  body: z.string().nullable(),
  name: z.string(),
  url: z.string().nullable(),
});
async function downloadResponse(value: unknown, preview: boolean) {
  const result = downloadSchema.parse(value);
  if (result.url !== null && !result.url.startsWith("local:"))
    return Response.redirect(result.url, 307);
  const bytes =
    result.url === null
      ? new TextEncoder().encode(result.body ?? "")
      : await readLocalObject(result.url.slice(6));
  return new Response(bytes.buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        result.url === null
          ? "text/markdown; charset=utf-8"
          : "application/octet-stream",
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(result.name)}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function GET(request: Request) {
  try {
    const fields = Object.fromEntries(new URL(request.url).searchParams);
    const name = fields.operation ?? "list";
    const principal = ["public", "public-download"].includes(name)
      ? { userId: "", source: "session" as const }
      : await currentPrincipal(request.headers);
    const result = await apiOperation("files", "GET", name).execute(
      { db: await getDatabase(), principal },
      fields,
    );
    return name === "download" || name === "public-download"
      ? downloadResponse(result, fields.preview === "true")
      : Response.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const input = z
      .object({})
      .passthrough()
      .parse(
        JSON.parse(
          new TextDecoder().decode(await limitedBody(request, 4 * 1024 * 1024)),
        ),
      );
    const operation = z
      .string()
      .parse(
        new URL(request.url).searchParams.get("operation") ?? input.operation,
      );
    const result = await apiOperation("files", "POST", operation).execute(
      { db: await getDatabase(), principal },
      input,
    );
    return Response.json(result, {
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
    const bytes = await limitedBody(request, MAX_UPLOAD_BYTES);
    const result = await apiOperation("files", "POST", "upload-bytes").execute(
      { db: await getDatabase(), principal },
      { ...fields, dataBase64: Buffer.from(bytes).toString("base64") },
    );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
