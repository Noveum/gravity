import { ZodError } from "zod";
import { DomainError } from "./policy";
export function errorResponse(error: unknown) {
  if (error instanceof DomainError)
    return Response.json({ error: error.code }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError)
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}
export async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new DomainError("FILE_SIZE", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new DomainError("FILE_SIZE", 413);
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
