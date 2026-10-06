import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DomainError } from "../core/policy";
import { isDemoMode } from "../database/client";
export interface FileStorage {
  uploadUrl(key: string, mimeType: string, size: number): Promise<string>;
  sealUpload(source: string, target: string, size: number): Promise<void>;
  downloadUrl(
    key: string,
    name: string,
    preview: boolean,
    mimeType?: string,
  ): Promise<string>;
  readText(key: string): Promise<string>;
}
function path(key: string) {
  if (!/^[a-f0-9-]{36}\/(pending|files)\/[a-f0-9-]{36}$/.test(key))
    throw new DomainError("NOT_FOUND", 404);
  return resolve(".data/library", key);
}
export async function writeLocalUpload(key: string, bytes: Uint8Array) {
  if (!isDemoMode()) throw new DomainError("FORBIDDEN", 403);
  const target = path(key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
export async function readLocalObject(key: string) {
  if (!isDemoMode()) throw new DomainError("FORBIDDEN", 403);
  return new Uint8Array(await readFile(path(key)));
}
let connection:
  | { client: S3Client; bucket: string; fingerprint: string }
  | undefined;
function storageConnection() {
  const {
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    S3_ENDPOINT,
    S3_REGION,
  } = process.env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)
    throw new DomainError("STORAGE_UNAVAILABLE", 503);
  const fingerprint = JSON.stringify([
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    S3_ENDPOINT,
    S3_REGION,
  ]);
  if (connection?.fingerprint !== fingerprint)
    connection = {
      bucket: S3_BUCKET,
      fingerprint,
      client: new S3Client({
        region: S3_REGION ?? "auto",
        ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
        credentials: {
          accessKeyId: S3_ACCESS_KEY_ID,
          secretAccessKey: S3_SECRET_ACCESS_KEY,
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
    };
  return connection;
}
export function objectStorage(): FileStorage {
  if (isDemoMode())
    return {
      uploadUrl: async (key) =>
        `/api/files?operation=upload-bytes&uploadId=${key.split("/").at(-1)}`,
      sealUpload: async (source, target, size) => {
        const bytes = await readLocalObject(source);
        if (bytes.length !== size) throw new DomainError("FILE_SIZE", 413);
        await writeLocalUpload(target, bytes);
      },
      downloadUrl: async (key) => `local:${key}`,
      readText: async (key) =>
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          await readLocalObject(key),
        ),
    };
  const { client, bucket: Bucket } = storageConnection();
  return {
    uploadUrl: async (Key, ContentType, ContentLength) =>
      getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }),
        { expiresIn: 600 },
      ),
    sealUpload: async (source, Key, size) => {
      const head = await client.send(
        new HeadObjectCommand({ Bucket, Key: source }),
      );
      if (head.ContentLength !== size || !head.ETag)
        throw new DomainError("FILE_SIZE", 413);
      await client.send(
        new CopyObjectCommand({
          Bucket,
          Key,
          CopySource: `${Bucket}/${source.split("/").map(encodeURIComponent).join("/")}`,
          CopySourceIfMatch: head.ETag,
          MetadataDirective: "REPLACE",
          ContentType: "application/octet-stream",
        }),
      );
    },
    downloadUrl: async (
      Key,
      name,
      preview,
      mimeType = "application/octet-stream",
    ) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key,
          ResponseContentType: preview ? mimeType : "application/octet-stream",
          ResponseContentDisposition: `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
          ResponseCacheControl: "private, no-store",
        }),
        { expiresIn: 60 },
      ),
    readText: async (Key) => {
      const result = await client.send(new GetObjectCommand({ Bucket, Key }));
      if (!result.Body) throw new DomainError("NOT_FOUND", 404);
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await result.Body.transformToByteArray(),
      );
    },
  };
}
