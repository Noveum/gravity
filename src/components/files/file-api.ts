import {
  fileDetailSchema,
  fileListingSchema,
  fileMutationSchema,
  fileUploadResponseSchema,
} from "@crm/files/validators";
import { z } from "zod";
import { requestJson } from "../client-api";
export interface FileScope {
  organizationId: string;
  productId: string;
}
export function fileUrl(
  scope: FileScope,
  fields: Record<string, string | null> = {},
) {
  const query = new URLSearchParams({ ...scope });
  for (const [key, value] of Object.entries(fields))
    if (value !== null) query.set(key, value);
  return `/api/files?${query}`;
}
export async function listFiles(
  scope: FileScope,
  parentId: string | null,
  signal?: AbortSignal,
) {
  return fileListingSchema.parse(
    await requestJson(fileUrl(scope, { parentId }), { signal }),
  );
}
export async function detail(
  scope: FileScope,
  id: string,
  signal?: AbortSignal,
) {
  return fileDetailSchema.parse(
    await requestJson(fileUrl(scope, { operation: "detail", id }), { signal }),
  );
}
export async function command(
  scope: FileScope,
  operation: string,
  input: object,
) {
  return fileMutationSchema.parse(
    await requestJson(`/api/files?operation=${encodeURIComponent(operation)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scope, ...input }),
    }),
  );
}
export async function reserve(
  scope: FileScope,
  file: File,
  parentId: string | null,
) {
  return fileUploadResponseSchema.parse(
    await requestJson("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...scope,
        operation: "reserve",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        parentId,
      }),
    }),
  );
}
export const publicDetailSchema = fileDetailSchema.extend({
  entries: z.array(fileDetailSchema.shape.entry),
});
