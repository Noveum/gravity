import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { authorize, DomainError, type Principal } from "../core/policy";
import { assertProductActive } from "../core/products";
import type { Database } from "../database/client";
import { isDemoMode } from "../database/client";
import * as s from "../database/schema";
import {
  type FileStorage,
  objectStorage,
  readLocalObject,
  storageConnection,
  writeLocalUpload,
} from "../files/storage";

export const maxFileSize = 100 * 1024 * 1024;
export const mimeTypes = ["application/pdf", "text/plain", "text/markdown"];

export async function readObject(key: string) {
  if (isDemoMode()) {
    try {
      return await readLocalObject(key);
    } catch {
      return new Uint8Array(await readFile(resolve(".data/files", key)));
    }
  }
  const { client, bucket: Bucket } = storageConnection();
  const object = await client.send(
    new GetObjectCommand({ Bucket, Key: key }),
  );
  if (!object.Body) throw new DomainError("NOT_FOUND", 404);
  return object.Body.transformToByteArray();
}

async function putObjectDirect(key: string, bytes: Uint8Array, mimeType: string) {
  if (isDemoMode()) {
    await writeLocalUpload(key, bytes);
  } else {
    const { client, bucket: Bucket } = storageConnection();
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key: key,
        Body: bytes,
        ContentType: mimeType,
      }),
    );
  }
}

export async function reserveAssetUpload(
  db: Database,
  principal: Principal,
  input: {
    organizationId: string;
    productId: string;
    folderId: string;
    stageIds: string[];
    name: string;
    mimeType: string;
    size: number;
    sha256?: string;
  },
  storage: FileStorage = objectStorage("materials"),
) {
  await authorize(db, principal, input.organizationId, input.productId, true);
  await assertProductActive(db, input.organizationId, input.productId);
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
  if (!input.size || input.size < 0 || input.size > maxFileSize)
    throw new DomainError("FILE_SIZE", 413);
  if (!mimeTypes.includes(input.mimeType))
    throw new DomainError("FILE_TYPE", 415);
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
  const uploadId = randomUUID();
  const storageKey = `${input.organizationId}/pending/${uploadId}`;
  const url = await storage.uploadUrl(storageKey, input.mimeType, input.size);
  await db.insert(s.assetUpload).values({
    id: uploadId,
    organizationId: input.organizationId,
    productId: input.productId,
    folderId: input.folderId,
    stageIds: input.stageIds,
    name: input.name.trim(),
    mimeType: input.mimeType,
    size: input.size,
    storageKey,
    sha256: input.sha256 ?? null,
    uploadedBy: principal.userId,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return { uploadId, url };
}

export async function putLocalMaterialUpload(
  db: Database,
  principal: Principal,
  input: {
    organizationId: string;
    productId: string;
    uploadId: string;
    bytes: Uint8Array;
  },
) {
  if (!isDemoMode()) throw new DomainError("FORBIDDEN", 403);
  await authorize(db, principal, input.organizationId, input.productId, true);
  const [upload] = await db
    .select()
    .from(s.assetUpload)
    .where(
      and(
        eq(s.assetUpload.id, input.uploadId),
        eq(s.assetUpload.organizationId, input.organizationId),
        eq(s.assetUpload.productId, input.productId),
        eq(s.assetUpload.uploadedBy, principal.userId),
      ),
    );
  if (!upload) throw new DomainError("NOT_FOUND", 404);
  if (upload.expiresAt.getTime() < Date.now())
    throw new DomainError("CONFLICT", 409);
  if (upload.size !== input.bytes.length)
    throw new DomainError("FILE_SIZE", 400);
  if (
    upload.mimeType === "application/pdf" &&
    new TextDecoder().decode(input.bytes.subarray(0, 5)) !== "%PDF-"
  )
    throw new DomainError("FILE_TYPE", 415);
  if (upload.mimeType.startsWith("text/")) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch {
      throw new DomainError("FILE_TYPE", 415);
    }
  }
  await writeLocalUpload(upload.storageKey, input.bytes);
  return { ok: true };
}

export async function completeAssetUpload(
  db: Database,
  principal: Principal,
  input: {
    organizationId: string;
    productId: string;
    uploadId: string;
  },
  storage: FileStorage = objectStorage("materials"),
) {
  await authorize(db, principal, input.organizationId, input.productId, true);
  const [reserved] = await db
    .select()
    .from(s.assetUpload)
    .where(
      and(
        eq(s.assetUpload.id, input.uploadId),
        eq(s.assetUpload.organizationId, input.organizationId),
        eq(s.assetUpload.productId, input.productId),
        eq(s.assetUpload.uploadedBy, principal.userId),
      ),
    );
  if (!reserved) throw new DomainError("NOT_FOUND", 404);
  if (reserved.expiresAt.getTime() < Date.now())
    throw new DomainError("CONFLICT", 409);
  const [folder] = await db
    .select()
    .from(s.folders)
    .where(
      and(
        eq(s.folders.id, reserved.folderId),
        eq(s.folders.organizationId, reserved.organizationId),
        eq(s.folders.productId, reserved.productId),
      ),
    );
  if (!folder) throw new DomainError("NOT_FOUND", 404);
  const allowedStages = await db
    .select()
    .from(s.stages)
    .where(
      and(
        eq(s.stages.organizationId, reserved.organizationId),
        eq(s.stages.productId, reserved.productId),
      ),
    );
  if (
    reserved.stageIds.some((id) => !allowedStages.some((stage) => stage.id === id))
  )
    throw new DomainError("FORBIDDEN", 403);
  const assetId = randomUUID();
  const finalKey = `${reserved.organizationId}/files/${assetId}`;
  await storage.sealUpload(reserved.storageKey, finalKey, reserved.size);
  if (isDemoMode()) {
    const bytes = await readLocalObject(finalKey);
    if (
      reserved.mimeType === "application/pdf" &&
      new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
    )
      throw new DomainError("FILE_TYPE", 415);
    if (reserved.mimeType.startsWith("text/")) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new DomainError("FILE_TYPE", 415);
      }
    }
  }
  return await db.transaction(async (tx) => {
    await assertProductActive(tx, reserved.organizationId, reserved.productId);
    const [current] = await tx
      .select()
      .from(s.assetUpload)
      .where(
        and(
          eq(s.assetUpload.id, input.uploadId),
          eq(s.assetUpload.organizationId, input.organizationId),
          eq(s.assetUpload.productId, input.productId),
          eq(s.assetUpload.uploadedBy, principal.userId),
        ),
      );
    if (!current) throw new DomainError("NOT_FOUND", 404);
    if (current.expiresAt.getTime() < Date.now())
      throw new DomainError("CONFLICT", 409);

    let sha256 = reserved.sha256;
    if (!sha256 && isDemoMode()) {
      const bytes = await readLocalObject(finalKey);
      sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    if (!sha256) {
      sha256 = "0".repeat(64);
    }

    const [asset] = await tx
      .insert(s.assets)
      .values({
        id: assetId,
        organizationId: reserved.organizationId,
        productId: reserved.productId,
        folderId: reserved.folderId,
        name: reserved.name,
        storageKey: finalKey,
        mimeType: reserved.mimeType,
        size: reserved.size,
        sha256,
        uploadedBy: principal.userId,
      })
      .returning();

    if (reserved.stageIds.length) {
      await tx.insert(s.assetStages).values(
        [...new Set(reserved.stageIds)].map((stageId) => ({
          organizationId: reserved.organizationId,
          productId: reserved.productId,
          assetId: asset.id,
          stageId,
        })),
      );
    }

    await tx.insert(s.changeEvents).values({
      organizationId: reserved.organizationId,
      productId: reserved.productId,
      actorId: principal.userId,
      type: "asset.uploaded",
      entityId: asset.id,
    });

    await tx.delete(s.assetUpload).where(eq(s.assetUpload.id, input.uploadId));

    return { id: asset.id, name: asset.name };
  });
}

export async function downloadAsset(
  db: Database,
  principal: Principal,
  organizationId: string,
  assetId: string,
  storage: FileStorage = objectStorage("materials"),
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
  const url = await storage.downloadUrl(
    asset.storageKey,
    asset.name,
    false,
    asset.mimeType,
  );
  return {
    asset,
    url,
    bytes: await readObject(asset.storageKey),
  };
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
  const reservation = await reserveAssetUpload(db, principal, {
    organizationId: input.organizationId,
    productId: input.productId,
    folderId: input.folderId,
    stageIds: input.stageIds,
    name: input.name,
    mimeType: input.mimeType,
    size: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
  });
  if (isDemoMode()) {
    await putLocalMaterialUpload(db, principal, {
      organizationId: input.organizationId,
      productId: input.productId,
      uploadId: reservation.uploadId,
      bytes: input.bytes,
    });
  } else {
    await putObjectDirect(
      `${input.organizationId}/pending/${reservation.uploadId}`,
      input.bytes,
      input.mimeType,
    );
  }
  return completeAssetUpload(db, principal, {
    organizationId: input.organizationId,
    productId: input.productId,
    uploadId: reservation.uploadId,
  });
}
