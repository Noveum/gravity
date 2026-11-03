import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
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

async function readObject(key: string) {
  if (isDemoMode()) {
    if (/^[a-f0-9-]{36}$/.test(key))
      return new Uint8Array(await readFile(resolve(".data/files", key)));
    return readLocalObject(key);
  }
  const { client, bucket: Bucket } = storageConnection();
  const object = await client.send(new GetObjectCommand({ Bucket, Key: key }));
  if (!object.Body) throw new DomainError("NOT_FOUND", 404);
  return object.Body.transformToByteArray();
}

async function validateSealedMaterial(
  storage: FileStorage,
  key: string,
  size: number,
  mimeType: string,
) {
  const hash = createHash("sha256");
  const decoder = mimeType.startsWith("text/")
    ? new TextDecoder("utf-8", { fatal: true })
    : undefined;
  const signature = new Uint8Array(5);
  let count = 0;
  for await (const bytes of storage.readChunks(key)) {
    if (count + bytes.length > size || count + bytes.length > maxFileSize)
      throw new DomainError("FILE_SIZE", 413);
    if (count < signature.length)
      signature.set(bytes.subarray(0, signature.length - count), count);
    count += bytes.length;
    hash.update(bytes);
    try {
      decoder?.decode(bytes, { stream: true });
    } catch {
      throw new DomainError("FILE_TYPE", 415);
    }
  }
  if (count !== size) throw new DomainError("FILE_SIZE", 413);
  if (
    mimeType === "application/pdf" &&
    new TextDecoder().decode(signature) !== "%PDF-"
  )
    throw new DomainError("FILE_TYPE", 415);
  try {
    decoder?.decode();
  } catch {
    throw new DomainError("FILE_TYPE", 415);
  }
  return hash.digest("hex");
}

async function putObjectDirect(
  key: string,
  bytes: Uint8Array,
  mimeType: string,
) {
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
  if (upload.completedAssetId || upload.expiresAt.getTime() < Date.now())
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
  // Consume durably before any remote mutation. Epoch expiration is a one-shot
  // attempt marker: failed/crashed attempts must never reuse their object key.
  // A delayed COPY or DELETE may still complete after its response times out.
  const claim = await db.transaction(async (tx) => {
    await authorize(tx, principal, input.organizationId, input.productId, true);
    const [reserved] = await tx
      .select()
      .from(s.assetUpload)
      .where(
        and(
          eq(s.assetUpload.id, input.uploadId),
          eq(s.assetUpload.organizationId, input.organizationId),
          eq(s.assetUpload.productId, input.productId),
          eq(s.assetUpload.uploadedBy, principal.userId),
        ),
      )
      .for("update");
    if (!reserved) throw new DomainError("NOT_FOUND", 404);
    if (reserved.completedAssetId) {
      await tx
        .select({ id: s.organizations.id })
        .from(s.organizations)
        .where(eq(s.organizations.id, input.organizationId))
        .for("share");
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      const [asset] = await tx
        .select()
        .from(s.assets)
        .where(
          and(
            eq(s.assets.id, reserved.completedAssetId),
            eq(s.assets.organizationId, input.organizationId),
            eq(s.assets.productId, input.productId),
          ),
        );
      if (!asset) throw new DomainError("NOT_FOUND", 404);
      return {
        kind: "completed" as const,
        asset: { id: asset.id, name: asset.name },
      };
    }
    if (reserved.expiresAt.getTime() === 0)
      throw new DomainError("UPLOAD_RESTART_REQUIRED", 409);
    if (reserved.expiresAt.getTime() < Date.now())
      throw new DomainError("CONFLICT", 409);
    await tx
      .update(s.assetUpload)
      .set({ expiresAt: new Date(0) })
      .where(eq(s.assetUpload.id, reserved.id));
    return { kind: "claimed" as const, upload: reserved };
  });
  if (claim.kind === "completed") return claim.asset;
  const reserved = claim.upload;
  let attemptedKey: string | undefined;
  try {
    return await db.transaction(async (tx) => {
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      const [current] = await tx
        .select()
        .from(s.assetUpload)
        .where(
          and(
            eq(s.assetUpload.id, reserved.id),
            eq(s.assetUpload.organizationId, input.organizationId),
            eq(s.assetUpload.productId, input.productId),
            eq(s.assetUpload.uploadedBy, principal.userId),
          ),
        )
        .for("update");
      if (!current) throw new DomainError("NOT_FOUND", 404);
      if (current.expiresAt.getTime() !== 0 || current.completedAssetId)
        throw new DomainError("UPLOAD_RESTART_REQUIRED", 409);
      const [folder] = await tx
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
      const allowedStages = await tx
        .select()
        .from(s.stages)
        .where(
          and(
            eq(s.stages.organizationId, reserved.organizationId),
            eq(s.stages.productId, reserved.productId),
          ),
        );
      if (
        reserved.stageIds.some(
          (id) => !allowedStages.some((stage) => stage.id === id),
        )
      )
        throw new DomainError("FORBIDDEN", 403);
      // This consumed reservation permits exactly one remote copy attempt.
      // Success replays use its receipt; failures require a fresh reservation.
      const assetId = reserved.id;
      const finalKey = `${reserved.organizationId}/files/${assetId}`;
      attemptedKey = finalKey;
      await storage.sealUpload(reserved.storageKey, finalKey, reserved.size);
      const sha256 = await validateSealedMaterial(
        storage,
        finalKey,
        reserved.size,
        reserved.mimeType,
      );
      if (reserved.sha256 && reserved.sha256.toLowerCase() !== sha256)
        throw new DomainError("FILE_CHECKSUM", 400);
      // Membership administration locks the organization. Take the matching read
      // lock after storage I/O so access cannot change between this check and commit.
      await tx
        .select({ id: s.organizations.id })
        .from(s.organizations)
        .where(eq(s.organizations.id, input.organizationId))
        .for("share");
      // Storage I/O may outlive an authorization change; check current access again.
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await assertProductActive(tx, input.organizationId, input.productId);
      if (reserved.expiresAt.getTime() < Date.now())
        throw new DomainError("CONFLICT", 409);
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
      if (reserved.stageIds.length)
        await tx.insert(s.assetStages).values(
          [...new Set(reserved.stageIds)].map((stageId) => ({
            organizationId: reserved.organizationId,
            productId: reserved.productId,
            assetId: asset.id,
            stageId,
          })),
        );
      await tx.insert(s.changeEvents).values({
        organizationId: reserved.organizationId,
        productId: reserved.productId,
        actorId: principal.userId,
        type: "asset.uploaded",
        entityId: asset.id,
      });
      await tx
        .update(s.assetUpload)
        .set({ completedAssetId: asset.id })
        .where(eq(s.assetUpload.id, input.uploadId));
      return { id: asset.id, name: asset.name };
    });
  } catch (error) {
    if (attemptedKey) {
      const finalKey = attemptedKey;
      try {
        const committed = await db.transaction(async (tx) => {
          // A fresh transaction must observe the first transaction's durable
          // outcome. This lock also prevents deletion racing a successful retry.
          const [receipt] = await tx
            .select()
            .from(s.assetUpload)
            .where(
              and(
                eq(s.assetUpload.id, input.uploadId),
                eq(s.assetUpload.organizationId, input.organizationId),
                eq(s.assetUpload.productId, input.productId),
                eq(s.assetUpload.uploadedBy, principal.userId),
              ),
            )
            .for("update");
          const [asset] = await tx
            .select()
            .from(s.assets)
            .where(
              and(
                eq(s.assets.organizationId, input.organizationId),
                eq(s.assets.productId, input.productId),
                eq(s.assets.storageKey, finalKey),
              ),
            );
          // Never infer rollback from a rejected COMMIT promise. Any asset or
          // completed receipt protects its object, even if the caller lost access.
          if (asset || receipt?.completedAssetId) {
            if (
              asset &&
              receipt?.completedAssetId === asset.id &&
              !(error instanceof DomainError)
            ) {
              await tx
                .select({ id: s.organizations.id })
                .from(s.organizations)
                .where(eq(s.organizations.id, input.organizationId))
                .for("share");
              await authorize(
                tx,
                principal,
                input.organizationId,
                input.productId,
                true,
              );
              return { id: asset.id, name: asset.name };
            }
            return undefined;
          }
          await storage.deleteObject(finalKey);
          return undefined;
        });
        if (committed) return committed;
      } catch {
        // An unavailable database cannot establish rollback; preserve bytes.
        // The durable one-shot marker prevents key reuse even if this worker
        // crashes, cleanup fails, or remote mutation finishes after a timeout.
        // Successful commits remain recoverable through their completion receipt.
      }
    }
    throw error;
  }
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
  };
}

// Content reads are explicit and use the same current authorization as URLs.
export async function readAssetContent(
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
