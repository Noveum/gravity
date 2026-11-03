import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { DomainError } from "../packages/core/policy";
import {
  createLocalDatabase,
  type Database,
} from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  completeAssetUpload,
  reserveAssetUpload,
} from "../packages/storage/files";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const owner = { userId: demoUser, source: "session" as const };
const org = demoId(1);
const product = demoId(10);
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => local.client.close());
async function reserve(
  bytes: Uint8Array,
  options: {
    mimeType?: string;
    sha256?: string;
    deleteFails?: boolean;
    sealFails?: boolean;
  } = {},
) {
  const objects = new Map<string, Uint8Array>();
  const targets: string[] = [];
  const storage = {
    uploadUrl: async () => "https://storage.example.test/upload",
    downloadUrl: async () => "https://storage.example.test/download",
    readText: async () => "",
    sealUpload: async (_source: string, key: string) => {
      objects.set(key, bytes);
      targets.push(key);
      if (options.sealFails) throw new Error("Copy response lost");
    },
    readChunks: async function* (key: string) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Object missing");
      yield bytes;
    },
    deleteObject: vi.fn(async (key: string) => {
      if (options.deleteFails) throw new Error("Storage unavailable");
      objects.delete(key);
    }),
  };
  const result = await reserveAssetUpload(
    local.db,
    owner,
    {
      organizationId: org,
      productId: product,
      folderId: demoId(900),
      stageIds: [],
      name: "Fictional material",
      mimeType: options.mimeType ?? "text/plain",
      size: bytes.length,
      sha256: options.sha256,
    },
    storage,
  );
  return {
    input: {
      organizationId: org,
      productId: product,
      uploadId: result.uploadId,
    },
    storage,
    objects,
    targets,
  };
}
function transactionFailure(
  mode: "rollback" | "commit" | "unavailable" | "rollback-unavailable",
) {
  let count = 0;
  return new Proxy(local.db, {
    get(target, property) {
      if (property !== "transaction")
        return Reflect.get(target, property, target);
      return async (...args: Parameters<Database["transaction"]>) => {
        count++;
        if (count > 1) {
          if (mode === "unavailable" || mode === "rollback-unavailable")
            throw new Error("Database unreachable");
          return target.transaction(...args);
        }
        if (mode === "rollback" || mode === "rollback-unavailable")
          return target.transaction(async (tx) => {
            await args[0](tx);
            throw new DomainError("CONFLICT", 409);
          });
        await target.transaction(...args);
        throw new Error("Commit acknowledgement lost");
      };
    },
  });
}
test.each([
  { mimeType: "application/pdf", sha256: undefined, code: "FILE_TYPE" },
  { mimeType: "text/plain", sha256: "a".repeat(64), code: "FILE_CHECKSUM" },
])(
  "a rejected $code completion removes its sealed object",
  async ({ mimeType, sha256, code }) => {
    const { input, storage, objects } = await reserve(
      Buffer.from("Fictional"),
      { mimeType, sha256 },
    );
    await expect(
      completeAssetUpload(local.db, owner, input, storage),
    ).rejects.toMatchObject({ code });
    expect(objects.size).toBe(0);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
  },
);
test("a copy that succeeds before reporting failure is cleaned up", async () => {
  const { input, storage, objects } = await reserve(Buffer.from("Fictional"), {
    sealFails: true,
  });
  await expect(
    completeAssetUpload(local.db, owner, input, storage),
  ).rejects.toThrow("Copy response lost");
  expect(objects.size).toBe(0);
});
test("a confirmed transaction rollback removes the uncommitted object", async () => {
  const { input, storage, objects } = await reserve(Buffer.from("Fictional"));
  await expect(
    completeAssetUpload(transactionFailure("rollback"), owner, input, storage),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(objects.size).toBe(0);
});
test("cleanup failure leaves one durable reservation target across repeated rejection", async () => {
  const { input, storage, objects, targets } = await reserve(
    Buffer.from("invalid"),
    { mimeType: "application/pdf", deleteFails: true },
  );
  for (let i = 0; i < 3; i++)
    await expect(
      completeAssetUpload(local.db, owner, input, storage),
    ).rejects.toMatchObject({ code: "FILE_TYPE" });
  expect(objects.size).toBe(1);
  expect(new Set(targets).size).toBe(1);
  expect(targets[0]).toBe(`${org}/files/${input.uploadId}`);
  const [receipt] = await local.db
    .select()
    .from(s.assetUpload)
    .where(eq(s.assetUpload.id, input.uploadId));
  expect(receipt.completedAssetId).toBeNull();
});
test("a lost commit acknowledgement reconciles to the durable result without deleting accepted bytes", async () => {
  const { input, storage, objects, targets } = await reserve(
    Buffer.from("Fictional"),
  );
  const result = await completeAssetUpload(
    transactionFailure("commit"),
    owner,
    input,
    storage,
  );
  expect(objects.size).toBe(1);
  expect(storage.deleteObject).not.toHaveBeenCalled();
  expect(await completeAssetUpload(local.db, owner, input, storage)).toEqual(
    result,
  );
  expect(targets).toHaveLength(1);
});
test("when commit reconciliation is unavailable preserve bytes until an authorized retry confirms the receipt", async () => {
  const { input, storage, objects, targets } = await reserve(
    Buffer.from("Fictional"),
  );
  await expect(
    completeAssetUpload(
      transactionFailure("unavailable"),
      owner,
      input,
      storage,
    ),
  ).rejects.toThrow("Commit acknowledgement lost");
  expect(objects.size).toBe(1);
  expect(storage.deleteObject).not.toHaveBeenCalled();
  const result = await completeAssetUpload(local.db, owner, input, storage);
  expect(result.id).toBeDefined();
  expect(targets).toHaveLength(1);
});

test("when rollback reconciliation is unavailable an authorized retry reuses the durable target", async () => {
  const { input, storage, objects, targets } = await reserve(
    Buffer.from("Fictional"),
  );
  await expect(
    completeAssetUpload(
      transactionFailure("rollback-unavailable"),
      owner,
      input,
      storage,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(objects.size).toBe(1);
  expect(storage.deleteObject).not.toHaveBeenCalled();
  const [pending] = await local.db
    .select()
    .from(s.assetUpload)
    .where(eq(s.assetUpload.id, input.uploadId));
  expect(pending.completedAssetId).toBeNull();
  const result = await completeAssetUpload(local.db, owner, input, storage);
  expect(result.id).toBe(input.uploadId);
  expect(new Set(targets).size).toBe(1);
  expect(objects.size).toBe(1);
});
