import { assertMutationOrigin, currentPrincipal } from "@crm/auth/server";
import { publishChange } from "@crm/core/changes";
import { errorResponse, limitedBody } from "@crm/core/http";
import { DomainError } from "@crm/core/policy";
import { getDatabase } from "@crm/database/client";
import { downloadAsset, maxFileSize, uploadAsset } from "@crm/storage/files";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const principal = await currentPrincipal(request.headers);
    const raw = await limitedBody(request, maxFileSize + 100000);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: raw,
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new DomainError("INVALID_INPUT", 400);
    const fields = z
      .object({
        organizationId: z.uuid(),
        productId: z.uuid(),
        folderId: z.uuid(),
        stageIds: z.array(z.uuid()),
      })
      .parse({
        organizationId: form.get("organizationId"),
        productId: form.get("productId"),
        folderId: form.get("folderId"),
        stageIds: form.getAll("stageIds"),
      });
    const result = await uploadAsset(await getDatabase(), principal, {
      ...fields,
      name: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    publishChange(fields.organizationId);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET(request: Request) {
  try {
    const principal = await currentPrincipal(request.headers);
    const fields = z
      .object({ organizationId: z.uuid(), assetId: z.uuid() })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const { asset, bytes } = await downloadAsset(
      await getDatabase(),
      principal,
      fields.organizationId,
      fields.assetId,
    );
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
