import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { objectStorage } from "../packages/files/storage";

const endpoint =
  process.env.FILE_STORAGE_TEST_ENDPOINT ?? "http://127.0.0.1:9030";
const target = new URL(endpoint);
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname),
  "Storage qualification requires an isolated local endpoint",
);
const bucket = `gravity-file-test-${randomUUID()}`;
process.env.CRM_DEMO_MODE = "false";
process.env.S3_ENDPOINT = endpoint;
process.env.S3_REGION = "us-east-1";
process.env.S3_BUCKET = bucket;
process.env.S3_ACCESS_KEY_ID =
  process.env.FILE_STORAGE_TEST_ACCESS_KEY ?? "gravityminio";
process.env.S3_SECRET_ACCESS_KEY =
  process.env.FILE_STORAGE_TEST_SECRET_KEY ?? "gravityminio";
const client = new S3Client({
  endpoint,
  forcePathStyle: true,
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
});
await client.send(new CreateBucketCommand({ Bucket: bucket }));
try {
  const storage = objectStorage();
  for (const original of [
    Buffer.from("Immutable document bytes"),
    Buffer.alloc(0),
  ]) {
    const source = `${randomUUID()}/pending/${randomUUID()}`;
    const final = `${randomUUID()}/files/${randomUUID()}`;
    const putUrl = await storage.uploadUrl(
      source,
      "application/octet-stream",
      original.length,
    );
    assert.equal(
      (await fetch(putUrl, { method: "PUT", body: original })).status,
      200,
    );
    await assert.rejects(
      () => storage.sealUpload(source, final, original.length + 1),
      { code: "FILE_SIZE" },
    );
    await storage.sealUpload(source, final, original.length);
    const signed = await storage.downloadUrl(final, "Résumé.txt", false);
    const downloaded = await fetch(signed);
    assert.equal(downloaded.status, 200);
    assert.match(
      downloaded.headers.get("content-disposition") ?? "",
      /attachment/,
    );
    assert.match(downloaded.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original);
    assert.equal(
      (
        await fetch(putUrl, {
          method: "PUT",
          body: Buffer.alloc(original.length, 65),
        })
      ).status,
      200,
    );
    const sealed = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: final }),
    );
    if (!sealed.Body) throw new Error("Sealed object missing");
    assert.deepEqual(
      Buffer.from(await sealed.Body.transformToByteArray()),
      original,
    );
    assert.equal((await fetch(`${endpoint}/${bucket}/${final}`)).status, 403);
  }
  const markdownSource = `${randomUUID()}/pending/${randomUUID()}`;
  const markdown = Buffer.from("# Résumé\n\n保存済み");
  await fetch(
    await storage.uploadUrl(markdownSource, "text/markdown", markdown.length),
    { method: "PUT", body: markdown },
  );
  assert.equal(
    await storage.readText(markdownSource),
    markdown.toString("utf8"),
  );
  const invalidSource = `${randomUUID()}/pending/${randomUUID()}`;
  await fetch(await storage.uploadUrl(invalidSource, "text/markdown", 1), {
    method: "PUT",
    body: Buffer.from([255]),
  });
  await assert.rejects(() => storage.readText(invalidSource));
  console.log(
    "Verified private signed uploads/downloads, exact sizes, empty files, immutable completion, replay resistance and strict UTF-8 on local S3.",
  );
} finally {
  const objects = await client.send(
    new ListObjectsV2Command({ Bucket: bucket }),
  );
  if (objects.Contents?.length)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.Contents.map((object) => ({ Key: object.Key })),
        },
      }),
    );
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  client.destroy();
}
