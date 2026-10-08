import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { readLocalObject } from "../packages/files/storage";
import {
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: CrmService;
const org = demoId(1);
const owner: Principal = { userId: demoUser, source: "session" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };
const reader: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: org,
  readOnly: true,
};
const overview = demoId(900);
const proof = demoId(901);

beforeEach(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  service = new CrmService(local.db);
});
afterEach(async () => {
  await local.client.close();
});

function find(name: string) {
  const operation = operations.find((item) => item.name === name);
  if (!operation) throw new Error(`MISSING_OPERATION:${name}`);
  return operation;
}
async function run<T = Record<string, unknown>>(
  name: string,
  principal: Principal,
  input: Record<string, unknown>,
) {
  return (await find(name).execute(
    { db: local.db, principal },
    { organizationId: org, ...input },
  )) as T;
}
async function folder(id: string) {
  const [row] = await local.db
    .select()
    .from(s.folders)
    .where(eq(s.folders.id, id));
  return row;
}
async function addAsset(folderId: string) {
  const [asset] = await local.db
    .insert(s.assets)
    .values({
      organizationId: org,
      productId: demoId(10),
      folderId,
      name: "Fictional brief.md",
      storageKey: randomUUID(),
      mimeType: "text/markdown",
      size: 12,
      sha256: "0".repeat(64),
      uploadedBy: demoUser,
    })
    .returning();
  if (!asset) throw new Error("asset fixture");
  return asset;
}

describe("rename_material_folder", () => {
  test("renames a folder and records a change event", async () => {
    const renamed = await run("rename_material_folder", owner, {
      folderId: overview,
      name: "  Product overview  ",
    });
    expect(renamed).toMatchObject({ id: overview, name: "Product overview" });
    expect((await folder(overview))?.name).toBe("Product overview");
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.type, "folder.renamed"));
    expect(events).toMatchObject([{ entityId: overview }]);
  });

  test("refuses an empty name, another product and a read-only grant", async () => {
    await expect(
      run("rename_material_folder", owner, { folderId: overview, name: " " }),
    ).rejects.toThrow();
    await expect(
      run("rename_material_folder", restricted, {
        folderId: overview,
        name: "Not mine",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run("rename_material_folder", reader, {
        folderId: overview,
        name: "Read only",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run("rename_material_folder", owner, {
        folderId: randomUUID(),
        name: "Missing",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("delete_material_folder", () => {
  test("deletes an empty folder", async () => {
    await expect(
      run("delete_material_folder", owner, { folderId: proof }),
    ).resolves.toMatchObject({ id: proof, deleted: true });
    expect(await folder(proof)).toBeUndefined();
  });

  test("refuses a folder that holds files or other folders", async () => {
    await addAsset(proof);
    await expect(
      run("delete_material_folder", owner, { folderId: proof }),
    ).rejects.toMatchObject({ code: "FOLDER_NOT_EMPTY", status: 409 });
    const child = await run<{ id: string }>("create_material_folder", owner, {
      productId: demoId(10),
      name: "Nested",
      parentId: overview,
    });
    await expect(
      run("delete_material_folder", owner, { folderId: overview }),
    ).rejects.toMatchObject({ code: "FOLDER_NOT_EMPTY" });
    await run("delete_material_folder", owner, { folderId: child.id });
    await expect(
      run("delete_material_folder", owner, { folderId: overview }),
    ).resolves.toMatchObject({ deleted: true });
  });

  test("needs write access to the folder's product", async () => {
    await expect(
      run("delete_material_folder", restricted, { folderId: proof }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await folder(proof)).toBeDefined();
    expect(operationRequirements(find("delete_material_folder"))).toMatchObject(
      {
        scopes: ["crm:read", "crm:write"],
        administrator: false,
        productAuthorization: true,
      },
    );
  });
});

describe("set_material_status", () => {
  test("moves an uploaded file out of draft with its current version", async () => {
    const asset = await addAsset(overview);
    expect(asset.status).toBe("draft");
    const approved = await run<{ status: string; version: number }>(
      "set_material_status",
      owner,
      { assetId: asset.id, version: asset.version, status: "approved" },
    );
    expect(approved).toMatchObject({
      status: "approved",
      version: asset.version + 1,
    });
    expect(approved).not.toHaveProperty("storageKey");
    await expect(
      run("set_material_status", owner, {
        assetId: asset.id,
        version: asset.version,
        status: "archived",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      run("set_material_status", owner, {
        assetId: asset.id,
        version: approved.version,
        status: "archived",
      }),
    ).resolves.toMatchObject({ status: "archived" });
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.entityId, asset.id));
    expect(events.map((event) => event.type)).toEqual([
      "asset.status_changed",
      "asset.status_changed",
    ]);
  });

  test("refuses an unknown status and a reader outside the product", async () => {
    const asset = await addAsset(overview);
    await expect(
      run("set_material_status", owner, {
        assetId: asset.id,
        version: asset.version,
        status: "published",
      }),
    ).rejects.toThrow();
    await expect(
      run("set_material_status", restricted, {
        assetId: asset.id,
        version: asset.version,
        status: "approved",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("direct-to-storage material uploads and downloads", () => {
  test("reserve, upload, complete and download without carrying bytes through function", async () => {
    const content = Buffer.from("%PDF-1.7\nFictional sales brief\n%%EOF");
    const reserved = await run<{ uploadId: string; url: string }>(
      "reserve_material_upload",
      owner,
      {
        productId: demoId(10),
        folderId: overview,
        stageIds: [demoId(800)],
        name: "Brief.pdf",
        mimeType: "application/pdf",
        size: content.length,
      },
    );
    expect(reserved.uploadId).toBeDefined();
    expect(reserved.url).toContain(reserved.uploadId);

    // 1. An unfinished upload is NEVER listed in s.assets or snapshot.assets
    const [assetInDb] = await local.db
      .select()
      .from(s.assets)
      .where(eq(s.assets.id, reserved.uploadId));
    expect(assetInDb).toBeUndefined();

    const snapshotBefore = await service.snapshot(owner, {
      organizationId: org,
      productId: demoId(10),
    });
    expect(
      snapshotBefore.assets.some(
        (a) => a.id === reserved.uploadId || a.name === "Brief.pdf",
      ),
    ).toBe(false);

    // 2. Put local upload bytes (demo transport)
    await run("put_local_material_upload", owner, {
      productId: demoId(10),
      uploadId: reserved.uploadId,
      dataBase64: content.toString("base64"),
    });

    // 3. Complete the upload
    const completed = await run<{ id: string; name: string }>(
      "complete_material_upload",
      owner,
      {
        productId: demoId(10),
        uploadId: reserved.uploadId,
      },
    );
    expect(completed.id).toBeDefined();
    expect(completed.name).toBe("Brief.pdf");

    // 4. NOW the completed asset is listed
    const snapshotAfter = await service.snapshot(owner, {
      organizationId: org,
      productId: demoId(10),
    });
    const found = snapshotAfter.assets.find((a) => a.id === completed.id);
    expect(found).toBeDefined();
    expect(found?.name).toBe("Brief.pdf");

    // 5. Download material returns signed URL and metadata, NO dataBase64
    const downloaded = await run<{
      assetId: string;
      name: string;
      version: number;
      mimeType: string;
      size: number;
      sha256: string;
      url: string;
      dataBase64?: unknown;
    }>("download_material", owner, {
      assetId: completed.id,
    });
    expect(downloaded.assetId).toBe(completed.id);
    expect(downloaded.name).toBe("Brief.pdf");
    expect(downloaded.mimeType).toBe("application/pdf");
    expect(downloaded.size).toBe(content.length);
    expect(downloaded.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(downloaded.url).toContain("local:");
    expect(downloaded.dataBase64).toBeUndefined();

    // Verify local storage bytes match original
    const storedBytes = await readLocalObject(downloaded.url.slice(6));
    expect(storedBytes).toEqual(new Uint8Array(content));

    // 6. Replay completion is rejected (404 because reservation was already removed)
    await expect(
      run("complete_material_upload", owner, {
        productId: demoId(10),
        uploadId: reserved.uploadId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("rejects size mismatch, invalid PDF header, and expired reservation", async () => {
    const reserved = await run<{ uploadId: string; url: string }>(
      "reserve_material_upload",
      owner,
      {
        productId: demoId(10),
        folderId: overview,
        stageIds: [],
        name: "Test.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );

    // Size mismatch on put
    await expect(
      run("put_local_material_upload", owner, {
        productId: demoId(10),
        uploadId: reserved.uploadId,
        dataBase64: Buffer.from("short").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "FILE_SIZE" });

    // Invalid PDF header
    await expect(
      run("put_local_material_upload", owner, {
        productId: demoId(10),
        uploadId: reserved.uploadId,
        dataBase64: Buffer.alloc(100, "a").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "FILE_TYPE" });

    // Expired reservation
    await local.db
      .update(s.assetUpload)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.assetUpload.id, reserved.uploadId));

    await expect(
      run("complete_material_upload", owner, {
        productId: demoId(10),
        uploadId: reserved.uploadId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("tenant and product isolation for sales materials", () => {
  test("cross-organization reservation, completion and download are rejected", async () => {
    // Attempting to reserve in another organization
    await expect(
      run("reserve_material_upload", owner, {
        organizationId: demoId(2),
        productId: demoId(10),
        folderId: overview,
        stageIds: [],
        name: "Cross.txt",
        mimeType: "text/plain",
        size: 10,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Add an asset in org 1
    const asset = await addAsset(overview);

    // Download with another organization ID rejects
    await expect(
      run("download_material", owner, {
        organizationId: demoId(2),
        assetId: asset.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a member restricted to another product cannot access materials", async () => {
    // restricted member only has access to demoId(11), overview folder is in demoId(10)
    await expect(
      run("reserve_material_upload", restricted, {
        productId: demoId(10),
        folderId: overview,
        stageIds: [],
        name: "Restricted.txt",
        mimeType: "text/plain",
        size: 10,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const asset = await addAsset(overview);

    // Restricted member attempting to download asset in product 10 is forbidden
    await expect(
      run("download_material", restricted, {
        assetId: asset.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
