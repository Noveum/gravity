import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { DomainError } from "../core/policy";

function encryptionKey() {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new DomainError("CONNECTOR_NOT_CONFIGURED", 503);
  return Buffer.from(key, "hex");
}
export function encryptionConfigured() {
  return /^[a-f0-9]{64}$/i.test(process.env.INTEGRATION_ENCRYPTION_KEY ?? "");
}
export function seal(value: unknown, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function unseal<T>(value: string, context: string): T {
  try {
    const [iv, tag, body] = value
      .split(".")
      .map((part) => Buffer.from(part, "base64url"));
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8"),
    );
  } catch {
    throw new DomainError("CONNECTION_UNAVAILABLE", 422);
  }
}
export const stateHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function verifyFirefliesSignature(
  raw: Uint8Array,
  signature: string | null,
  secret: string,
) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return false;
  // Signature is over exact bytes; event IDs provide replay deduplication.
  return timingSafeEqual(
    Buffer.from(signature.slice(7), "hex"),
    createHmac("sha256", secret).update(raw).digest(),
  );
}

import { createHmac } from "node:crypto";
