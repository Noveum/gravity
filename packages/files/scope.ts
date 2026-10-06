import { authorize, DomainError, type Principal } from "../core/policy";
import type { Database } from "../database/client";
export type Executor = Database;
export interface FilePrincipal extends Principal {
  organizationId: string;
  productId: string;
  role: string;
  writable: boolean;
}
export interface FileContext {
  db: Database;
  principal: FilePrincipal;
}
export interface FileBatch {
  tx: Database;
  context: FileContext;
  organizationId: string;
}
export async function fileScope(
  db: Database,
  principal: Principal,
  input: { organizationId: string; productId: string },
  write = false,
): Promise<FileContext> {
  const { membership } = await authorize(
    db,
    principal,
    input.organizationId,
    input.productId,
    write,
  );
  return {
    db,
    principal: {
      ...principal,
      ...input,
      role: membership.role,
      writable:
        !principal.readOnly &&
        (principal.source !== "mcp" || principal.readOnly === false),
    },
  };
}
export function assertCan(
  principal: FilePrincipal,
  action: "record:read" | "record:write",
) {
  if (action === "record:write" && !principal.writable)
    throw forbidden("Write permission required.");
}
export const validationFailed = (message: string) =>
  new DomainError("INVALID_INPUT", 400, { reason: message });
export const forbidden = (message: string) =>
  new DomainError("FORBIDDEN", 403, { reason: message });
export const conflict = (message: string) =>
  new DomainError("CONFLICT", 409, { reason: message });
export const notFound = (message: string) =>
  new DomainError("NOT_FOUND", 404, { reason: message });
export function requireRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) throw notFound(message);
  return row;
}
