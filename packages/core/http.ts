import { ZodError } from "zod";
import { DomainError } from "./policy";

const retryableCodes = new Set(["40P01", "40001"]);
function transactionConflict(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 4) return false;
  const code = (error as Error & { code?: unknown }).code;
  return (
    (typeof code === "string" && retryableCodes.has(code)) ||
    transactionConflict(error.cause, depth + 1)
  );
}
export function errorResponse(error: unknown) {
  if (error instanceof DomainError)
    return Response.json(
      {
        error: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  if (transactionConflict(error))
    return Response.json(
      { error: "CONFLICT", retryable: true },
      { status: 409 },
    );
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
