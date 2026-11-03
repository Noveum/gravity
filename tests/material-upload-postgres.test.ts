import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import type { FileStorage } from "../packages/files/storage";
import {
  completeAssetUpload,
  reserveAssetUpload,
} from "../packages/storage/files";

const serverUrl = process.env.GRAVITY_POSTGRES_TEST_URL ?? "";
const usable =
  serverUrl !== "" &&
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    new URL(serverUrl).hostname,
  );
describe.skipIf(!usable)("material completion on PostgreSQL", () => {
  const name = `gravity_materials_${randomUUID().replaceAll("-", "")}`;
  let server: postgres.Sql;
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof s>>;
  const owner = { userId: demoUser, source: "session" as const };
  beforeAll(async () => {
    server = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await server.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema: s });
    await migrate(db, { migrationsFolder: resolve("drizzle") });
    await seedDemo(db);
  }, 120000);
  afterAll(async () => {
    await client?.end();
    await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await server?.end();
  });
  async function reserve(beforeRead?: () => Promise<void>) {
    const bytes = Buffer.from("Fictional immutable material €");
    const targets: string[] = [];
    const deleted: string[] = [];
    const storage: FileStorage = {
      deleteObject: async (key) => {
        deleted.push(key);
      },
      uploadUrl: async () => "https://storage.example.test/upload",
      sealUpload: async (_source, target) => {
        targets.push(target);
      },
      downloadUrl: async () => "https://storage.example.test/download",
      readText: async () => "",
      readChunks: async function* () {
        await beforeRead?.();
        yield bytes;
      },
    };
    const result = await reserveAssetUpload(
      db,
      owner,
      {
        organizationId: demoId(1),
        productId: demoId(10),
        folderId: demoId(900),
        stageIds: [],
        name: "Fictional.txt",
        mimeType: "text/plain",
        size: bytes.length,
      },
      storage,
    );
    return {
      storage,
      targets,
      deleted,
      input: {
        organizationId: demoId(1),
        productId: demoId(10),
        uploadId: result.uploadId,
      },
    };
  }
  test("concurrent completions return one durable asset without overwriting its object", async () => {
    const { storage, targets, input } = await reserve();
    const results = await Promise.all([
      completeAssetUpload(db, owner, input, storage),
      completeAssetUpload(db, owner, input, storage),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(targets).toHaveLength(1);
    const events = await db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.entityId, results[0].id));
    expect(events.filter((e) => e.type === "asset.uploaded")).toHaveLength(1);
    await db
      .update(s.assetUpload)
      .set({ expiresAt: new Date(0) })
      .where(eq(s.assetUpload.id, input.uploadId));
    expect(await completeAssetUpload(db, owner, input, storage)).toEqual(
      results[0],
    );
    expect(targets).toHaveLength(1);
  });
  test("membership revoked during storage validation prevents completion and replay", async () => {
    const { storage, input, deleted } = await reserve(async () => {
      await db
        .update(s.memberships)
        .set({ active: false })
        .where(eq(s.memberships.userId, demoUser));
    });
    try {
      await expect(
        completeAssetUpload(db, owner, input, storage),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const [receipt] = await db
        .select()
        .from(s.assetUpload)
        .where(eq(s.assetUpload.id, input.uploadId));
      expect(receipt.completedAssetId).toBeNull();
      expect(deleted).toHaveLength(1);
    } finally {
      await db
        .update(s.memberships)
        .set({ active: true })
        .where(eq(s.memberships.userId, demoUser));
    }
  });
  test("a stale MCP product grant cannot complete after current product membership is revoked during validation", async () => {
    await db
      .insert(s.productMemberships)
      .values({
        organizationId: demoId(1),
        productId: demoId(10),
        userId: "demo-restricted",
      })
      .onConflictDoNothing();
    const member = {
      userId: "demo-restricted",
      source: "mcp" as const,
      organizationId: demoId(1),
      productIds: [demoId(10)],
      readOnly: false,
    };
    const bytes = Buffer.from("Fictional material");
    const storage: FileStorage = {
      deleteObject: async () => {},
      uploadUrl: async () => "https://storage.example.test/upload",
      sealUpload: async () => {},
      downloadUrl: async () => "https://storage.example.test/download",
      readText: async () => "",
      readChunks: async function* () {
        await db
          .delete(s.productMemberships)
          .where(eq(s.productMemberships.userId, "demo-restricted"));
        yield bytes;
      },
    };
    const reservation = await reserveAssetUpload(
      db,
      member,
      {
        organizationId: demoId(1),
        productId: demoId(10),
        folderId: demoId(900),
        stageIds: [],
        name: "Fictional.txt",
        mimeType: "text/plain",
        size: bytes.length,
      },
      storage,
    );
    await expect(
      completeAssetUpload(
        db,
        member,
        {
          organizationId: demoId(1),
          productId: demoId(10),
          uploadId: reservation.uploadId,
        },
        storage,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [receipt] = await db
      .select()
      .from(s.assetUpload)
      .where(eq(s.assetUpload.id, reservation.uploadId));
    expect(receipt.completedAssetId).toBeNull();
  });
  test("another member cannot complete an owned upload", async () => {
    const { storage, targets, input } = await reserve();
    await db
      .insert(s.productMemberships)
      .values({
        organizationId: demoId(1),
        productId: demoId(10),
        userId: "demo-restricted",
      })
      .onConflictDoNothing();
    await expect(
      completeAssetUpload(
        db,
        { userId: "demo-restricted", source: "session" },
        input,
        storage,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(targets).toHaveLength(0);
  });
  test("cleanup serializes with a retry and never deletes its accepted object", async () => {
    const { storage, input, targets } = await reserve();
    const bytes = Buffer.from("Fictional immutable material €");
    const objects = new Map<string, Uint8Array>();
    let reads = 0;
    let cleanupStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    let releaseCleanup!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    storage.sealUpload = async (_source, target) => {
      targets.push(target);
      objects.set(target, bytes);
    };
    storage.readChunks = async function* () {
      yield reads++ === 0 ? Buffer.alloc(bytes.length, 0xff) : bytes;
    };
    storage.deleteObject = async (key) => {
      cleanupStarted();
      await released;
      objects.delete(key);
    };
    const rejected = completeAssetUpload(db, owner, input, storage).then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    );
    await started;
    let accepted: ReturnType<typeof completeAssetUpload> | undefined;
    try {
      accepted = completeAssetUpload(db, owner, input, storage);
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows =
          await client`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%asset_upload%'`;
        if (rows.length) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      expect(targets).toHaveLength(1);
    } finally {
      releaseCleanup();
    }
    expect((await rejected).error).toMatchObject({ code: "FILE_TYPE" });
    const result = await accepted;
    expect(result?.id).toBe(input.uploadId);
    expect(new Set(targets).size).toBe(1);
    expect(objects.get(`${demoId(1)}/files/${input.uploadId}`)).toEqual(bytes);
    expect(await completeAssetUpload(db, owner, input, storage)).toEqual(
      result,
    );
    expect(targets).toHaveLength(2);
  });
});
