import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { authorize, DomainError, type Principal } from "../core/policy";
import { assertProductActive } from "../core/products";
import type { Database } from "../database/client";
import { isDemoMode } from "../database/client";
import * as s from "../database/schema";

export const maxFileSize = 10 * 1024 * 1024;
const mimeTypes = ["application/pdf", "text/plain", "text/markdown"];
function client() {
  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)
    throw new DomainError("STORAGE_UNAVAILABLE", 503);
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  });
}
async function put(key: string, bytes: Uint8Array, mimeType: string) {
  if (isDemoMode()) {
    await mkdir(".data/files", { recursive: true });
    await writeFile(resolve(".data/files", key), bytes);
  } else
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: mimeType,
      }),
    );
}
async function remove(key: string) {
  if (isDemoMode()) await unlink(resolve(".data/files", key));
  else
    await client().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
}
export async function readObject(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new DomainError("NOT_FOUND", 404);
  if (isDemoMode())
    return new Uint8Array(await readFile(resolve(".data/files", key)));
  const object = await client().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
  if (!object.Body) throw new DomainError("NOT_FOUND", 404);
  return object.Body.transformToByteArray();
}
export async function uploadAsset(
  db: Database,
  principal: Principal,
  input: {
    organizationId: string;
    productId: string;
    folderId: string;
    stageIds: string[];
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  },
) {
  await authorize(db, principal, input.organizationId, input.productId, true);
  const [folder] = await db
    .select()
    .from(s.folders)
    .where(
      and(
        eq(s.folders.id, input.folderId),
        eq(s.folders.organizationId, input.organizationId),
        eq(s.folders.productId, input.productId),
      ),
    );
  if (!folder) throw new DomainError("NOT_FOUND", 404);
  if (!input.bytes.length || input.bytes.length > maxFileSize)
    throw new DomainError("FILE_SIZE", 413);
  if (!mimeTypes.includes(input.mimeType))
    throw new DomainError("FILE_TYPE", 415);
  if (
    input.mimeType === "application/pdf" &&
    new TextDecoder().decode(input.bytes.subarray(0, 5)) !== "%PDF-"
  )
    throw new DomainError("FILE_TYPE", 415);
  if (input.mimeType.startsWith("text/")) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch {
      throw new DomainError("FILE_TYPE", 415);
    }
  }
  if (!input.name.trim() || input.name.length > 200)
    throw new DomainError("INVALID_INPUT", 400);
  const allowedStages = await db
    .select()
    .from(s.stages)
    .where(
      and(
        eq(s.stages.organizationId, input.organizationId),
        eq(s.stages.productId, input.productId),
      ),
    );
  if (
    input.stageIds.some((id) => !allowedStages.some((stage) => stage.id === id))
  )
    throw new DomainError("FORBIDDEN", 403);
  const key = randomUUID();
  await put(key, input.bytes, input.mimeType);
  try {
    return await db.transaction(async (tx) => {
      await assertProductActive(tx, input.organizationId, input.productId);
      const [asset] = await tx
        .insert(s.assets)
        .values({
          organizationId: input.organizationId,
          productId: input.productId,
          folderId: input.folderId,
          name: input.name.trim(),
          storageKey: key,
          mimeType: input.mimeType,
          size: input.bytes.length,
          sha256: createHash("sha256").update(input.bytes).digest("hex"),
          uploadedBy: principal.userId,
        })
        .returning();
      if (input.stageIds.length)
        await tx.insert(s.assetStages).values(
          [...new Set(input.stageIds)].map((stageId) => ({
            organizationId: input.organizationId,
            productId: input.productId,
            assetId: asset.id,
            stageId,
          })),
        );
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: "asset.uploaded",
        entityId: asset.id,
      });
      return { id: asset.id, name: asset.name };
    });
  } catch (error) {
    await remove(key).catch(() => undefined);
    throw error;
  }
}
export async function downloadAsset(
  db: Database,
  principal: Principal,
  organizationId: string,
  assetId: string,
) {
  const [asset] = await db
    .select()
    .from(s.assets)
    .where(
      and(
        eq(s.assets.organizationId, organizationId),
        eq(s.assets.id, assetId),
      ),
    );
  if (!asset) throw new DomainError("NOT_FOUND", 404);
  await authorize(db, principal, organizationId, asset.productId);
  return { asset, bytes: await readObject(asset.storageKey) };
}
