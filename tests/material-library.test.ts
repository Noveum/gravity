import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
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
