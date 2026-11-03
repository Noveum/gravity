import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  completeAssetUpload,
  downloadAsset,
  reserveAssetUpload,
} from "../packages/storage/files";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const product = demoId(10);
const owner = { userId: demoUser, source: "session" as const };
function storageFor(bytes: Uint8Array) {
  return {
    uploadUrl: async () => "https://storage.example.test/upload",
    sealUpload: vi.fn(async () => {}),
    downloadUrl: async () => "https://storage.example.test/download",
    readText: async () => "",
    readChunks: vi.fn(async function* () {
      for (let i = 0; i < bytes.length; i += 2) yield bytes.subarray(i, i + 2);
    }),
  };
}
async function reserve(bytes: Uint8Array, mimeType: string, sha256?: string) {
  const storage = storageFor(bytes);
  const reserved = await reserveAssetUpload(
    local.db,
    owner,
    {
      organizationId: org,
      productId: product,
      folderId: demoId(900),
      stageIds: [],
      name: "Fictional material",
      mimeType,
      size: bytes.length,
      sha256,
    },
    storage,
  );
  return {
    storage,
    input: {
      organizationId: org,
      productId: product,
      uploadId: reserved.uploadId,
    },
  };
}
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => {
  await local.client.close();
});

test("production completion validates sealed PDF bytes", async () => {
  const { storage, input } = await reserve(
    Buffer.from("wrong"),
    "application/pdf",
  );
  vi.stubEnv("NODE_ENV", "production");
  try {
    await expect(
      completeAssetUpload(local.db, owner, input, storage),
    ).rejects.toMatchObject({ code: "FILE_TYPE" });
    expect(storage.readChunks).toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});

test("production completion records the actual SHA256 and rejects a supplied mismatch", async () => {
  const bytes = Buffer.from("Fictional UTF-8 € material");
  const good = await reserve(bytes, "text/plain");
  const wrong = await reserve(bytes, "text/plain", "a".repeat(64));
  vi.stubEnv("NODE_ENV", "production");
  try {
    const result = await completeAssetUpload(
      local.db,
      owner,
      good.input,
      good.storage,
    );
    const [asset] = await local.db
      .select()
      .from(s.assets)
      .where(eq(s.assets.id, result.id));
    expect(asset.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    await expect(
      completeAssetUpload(local.db, owner, wrong.input, wrong.storage),
    ).rejects.toMatchObject({ code: "FILE_CHECKSUM" });
  } finally {
    vi.unstubAllEnvs();
  }
});

test("a URL-only download does not read backing bytes", async () => {
  const [asset] = await local.db
    .insert(s.assets)
    .values({
      organizationId: org,
      productId: product,
      folderId: demoId(900),
      name: "Fictional.md",
      mimeType: "text/markdown",
      size: 10,
      sha256: "0".repeat(64),
      storageKey: "missing-object",
      uploadedBy: demoUser,
    })
    .returning();
  const storage = storageFor(Buffer.from("unused"));
  await expect(
    downloadAsset(local.db, owner, org, asset.id, storage),
  ).resolves.toMatchObject({ url: "https://storage.example.test/download" });
  expect(storage.readChunks).not.toHaveBeenCalled();
});

test.each(["short", "long"])(
  "completion rejects %s sealed content even when provider reports the requested size",
  async (kind) => {
    const bytes = Buffer.from("Fictional text");
    const { storage, input } = await reserve(bytes, "text/plain");
    storage.readChunks = vi.fn(async function* () {
      yield kind === "short"
        ? bytes.subarray(0, -1)
        : Buffer.concat([bytes, Buffer.from("extra")]);
    });
    await expect(
      completeAssetUpload(local.db, owner, input, storage),
    ).rejects.toMatchObject({ code: "FILE_SIZE" });
    const [receipt] = await local.db
      .select()
      .from(s.assetUpload)
      .where(eq(s.assetUpload.id, input.uploadId));
    expect(receipt.completedAssetId).toBeNull();
  },
);
