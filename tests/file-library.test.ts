import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { fileScope } from "../packages/files/scope";
import { completeFileUpload, getFile } from "../packages/files/service";
import { objectStorage, readLocalObject } from "../packages/files/storage";
import {
  fileDetailSchema,
  fileMutationSchema,
  fileUploadResponseSchema,
} from "../packages/files/validators";
import {
  apiOperation,
  executeMcpOperation,
  operationInput,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const scope = { organizationId: demoId(1), productId: demoId(10) };
const owner: Principal = { userId: demoUser, source: "session" };
const member: Principal = { userId: "demo-teammate", source: "session" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };
async function run(operation: string, input: object = {}, principal = owner) {
  const method = [
    "list",
    "detail",
    "download",
    "public",
    "public-download",
  ].includes(operation)
    ? "GET"
    : "POST";
  return apiOperation("files", method, operation).execute(
    { db: local.db, principal },
    { ...scope, ...input },
  );
}
async function create(input: object) {
  const result = fileMutationSchema.parse(
    await run("create", { kind: "folder", name: randomUUID(), ...input }),
  );
  return result.entries[0];
}
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => {
  await local.client.close();
});
describe("production file library access and persistence", () => {
  test("every action has the complete shared HTTP and MCP schema", () => {
    const names = [
      "list_files",
      "get_file",
      "create_file",
      "update_file",
      "transfer_files",
      "reserve_file_upload",
      "complete_file_upload",
      "download_file",
      "get_public_file",
      "download_public_file",
    ];
    for (const name of names) {
      const item = operations.find((operation) => operation.name === name);
      expect(item).toBeTruthy();
      if (!item) throw new Error(`Missing operation ${name}`);
      expect(operationInput(item).shape).toBeTruthy();
    }
  });
  test("nested folders preserve inheritance and atomic Markdown updates", async () => {
    const root = await create({ visibility: "workspace" });
    const nested = await create({ parentId: root.id, visibility: "inherit" });
    const file = await create({
      kind: "markdown",
      parentId: nested.id,
      visibility: "inherit",
      body: "# First",
    });
    expect(
      fileDetailSchema.parse(await run("detail", { id: file.id }, member)).body,
    ).toBe("# First");
    const updated = fileMutationSchema.parse(
      await run(
        "update",
        { id: file.id, body: "# Saved", expectedSyncId: file.syncId },
        member,
      ),
    ).entries[0];
    expect(updated.syncId).toBe(file.syncId + 1);
    expect(
      fileDetailSchema.parse(await run("detail", { id: file.id })).body,
    ).toBe("# Saved");
    await expect(
      run("update", {
        id: file.id,
        body: "# Stale",
        expectedSyncId: file.syncId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const list = (await run("list", { parentId: nested.id })) as {
      ancestors: { id: string }[];
      entries: { id: string }[];
    };
    expect(list.ancestors.map((item) => item.id)).toEqual([root.id, nested.id]);
    expect(list.entries.map((item) => item.id)).toEqual([file.id]);
  });
  test("private and explicit-person access require readable ancestors", async () => {
    const root = await create({ visibility: "private" });
    const file = await create({
      kind: "markdown",
      parentId: root.id,
      visibility: "shared",
      grants: [{ userId: member.userId, role: "editor" }],
      body: "Private content",
    });
    await expect(run("detail", { id: file.id }, member)).rejects.toMatchObject({
      status: 404,
    });
    const shared = fileMutationSchema
      .parse(
        await run("update", {
          id: root.id,
          expectedSyncId: root.syncId,
          access: {
            visibility: "shared",
            grants: [{ userId: member.userId, role: "viewer" }],
          },
        }),
      )
      .entries.find((item) => item.id === root.id);
    if (!shared) throw new Error("Shared folder missing");
    expect(
      fileDetailSchema.parse(await run("detail", { id: file.id }, member)).entry
        .canEdit,
    ).toBe(true);
    await run(
      "update",
      { id: file.id, expectedSyncId: shared.syncId, body: "Editor saved" },
      member,
    );
    await expect(
      run(
        "update",
        {
          id: file.id,
          expectedSyncId: shared.syncId + 1,
          access: { visibility: "public", grants: [] },
        },
        member,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await run("update", {
      id: root.id,
      expectedSyncId: shared.syncId,
      access: { visibility: "private", grants: [] },
    });
    await expect(run("detail", { id: file.id }, member)).rejects.toMatchObject({
      status: 404,
    });
  });
  test("public links recheck every ancestor and can be revoked", async () => {
    const root = await create({ visibility: "public" });
    const file = await create({
      kind: "markdown",
      parentId: root.id,
      visibility: "inherit",
      body: "Public content",
    });
    expect(file.publicToken).toBeTruthy();
    expect(
      fileDetailSchema.parse(
        await run("public", { token: file.publicToken }, restricted),
      ).body,
    ).toBe("Public content");
    await run("update", {
      id: root.id,
      expectedSyncId: root.syncId,
      access: { visibility: "private", grants: [] },
    });
    await expect(
      run("public", { token: file.publicToken }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      run("public-download", { token: file.publicToken }),
    ).rejects.toMatchObject({ status: 404 });
  });
  test("workspace sharing cannot override tenant, product or read-only MCP grants", async () => {
    const file = await create({
      kind: "markdown",
      visibility: "workspace",
      body: "Product scoped",
    });
    await expect(
      run("detail", { id: file.id }, restricted),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      run("detail", { id: file.id, organizationId: demoId(2) }, member),
    ).rejects.toMatchObject({ status: 403 });
    const mcp = {
      ...owner,
      source: "mcp" as const,
      organizationId: scope.organizationId,
      productIds: [demoId(11)],
      readOnly: false,
    };
    const action = apiOperation("files", "GET", "detail");
    await expect(
      executeMcpOperation(
        action,
        { db: local.db, principal: mcp },
        scope.organizationId,
        { productId: scope.productId, id: file.id },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      run(
        "create",
        { name: "Blocked", kind: "folder" },
        { ...owner, source: "mcp", readOnly: true },
      ),
    ).rejects.toMatchObject({ status: 403 });
    const write = apiOperation("files", "POST", "create");
    const created = fileMutationSchema.parse(
      await executeMcpOperation(
        write,
        { db: local.db, principal: { ...mcp, productIds: [scope.productId] } },
        scope.organizationId,
        {
          productId: scope.productId,
          kind: "markdown",
          name: randomUUID(),
          body: "MCP saved",
        },
      ),
    );
    expect(
      fileDetailSchema.parse(await run("detail", { id: created.entries[0].id }))
        .body,
    ).toBe("MCP saved");
  });
  test("a previously constructed principal cannot outlive current membership", async () => {
    const file = await create({
      visibility: "workspace",
      kind: "markdown",
      body: "Before removal",
    });
    const authorized = await fileScope(local.db, member, scope);
    await local.db
      .update(s.memberships)
      .set({ active: false })
      .where(
        and(
          eq(s.memberships.organizationId, scope.organizationId),
          eq(s.memberships.userId, member.userId),
        ),
      );
    await expect(
      getFile(local.db, authorized.principal, file.id),
    ).rejects.toMatchObject({ status: 403 });
    await local.db
      .update(s.memberships)
      .set({ active: true })
      .where(
        and(
          eq(s.memberships.organizationId, scope.organizationId),
          eq(s.memberships.userId, member.userId),
        ),
      );
  });
  test("copy and move preserve bytes and enforce complete ownership and cycle checks", async () => {
    const root = await create({ visibility: "workspace" }),
      nested = await create({ parentId: root.id, visibility: "inherit" }),
      destination = await create({ visibility: "private" });
    const file = await create({
      kind: "markdown",
      parentId: nested.id,
      visibility: "inherit",
      body: "# Copy me",
    });
    await expect(
      run("transfer", {
        ids: [root.id],
        operation: "move",
        parentId: nested.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      run(
        "transfer",
        { ids: [file.id], operation: "delete", parentId: null },
        member,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const copies = fileMutationSchema.parse(
      await run("transfer", {
        ids: [nested.id],
        operation: "copy",
        parentId: destination.id,
      }),
    ).entries;
    const copy = copies.find((item) => item.kind === "markdown");
    if (!copy) throw new Error("Copied Markdown missing");
    expect(
      fileDetailSchema.parse(await run("detail", { id: copy.id })).body,
    ).toBe("# Copy me");
    const copiedFolder = copies.find((item) => item.kind === "folder");
    if (!copiedFolder) throw new Error("Copied folder missing");
    expect(copiedFolder.visibility).toBe("private");
    await run("transfer", {
      ids: [nested.id],
      operation: "move",
      parentId: (await create({ visibility: "private" })).id,
    });
    expect(
      fileDetailSchema.parse(await run("detail", { id: file.id })).body,
    ).toBe("# Copy me");
    await run("transfer", {
      ids: [nested.id],
      operation: "delete",
      parentId: null,
    });
    await expect(run("detail", { id: file.id })).rejects.toMatchObject({
      status: 404,
    });
  });
  test("uploads seal immutable bytes, preserve every format and reject size mismatches and replay", async () => {
    for (const name of [
      "Slides.pptx",
      "Workbook.xlsx",
      "Report.docx",
      "Photo.png",
      "Archive.zip",
      "Empty.txt",
    ]) {
      const bytes = new TextEncoder().encode(
        name === "Empty.txt" ? "" : `Original ${name}`,
      );
      const reserved = fileUploadResponseSchema.parse(
        await run("reserve", {
          name,
          mimeType: "application/octet-stream",
          size: bytes.length,
        }),
      );
      await run("upload-bytes", {
        uploadId: reserved.uploadId,
        dataBase64: Buffer.from(bytes).toString("base64"),
      });
      const uploaded = fileMutationSchema.parse(
        await run("complete", { uploadId: reserved.uploadId }),
      ).entries[0];
      const download = (await run("download", { id: uploaded.id })) as {
        url: string;
      };
      expect(await readLocalObject(download.url.slice(6))).toEqual(bytes);
      await expect(
        run("complete", { uploadId: reserved.uploadId }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        run("upload-bytes", {
          uploadId: reserved.uploadId,
          dataBase64: Buffer.from("Replayed").toString("base64"),
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await readLocalObject(download.url.slice(6))).toEqual(bytes);
    }
    const reserved = fileUploadResponseSchema.parse(
      await run("reserve", {
        name: "Mismatch.pdf",
        mimeType: "application/pdf",
        size: 20,
      }),
    );
    await expect(
      run("upload-bytes", {
        uploadId: reserved.uploadId,
        dataBase64: Buffer.from("short").toString("base64"),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      run(
        "upload-bytes",
        {
          uploadId: reserved.uploadId,
          dataBase64: Buffer.alloc(20).toString("base64"),
        },
        member,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  test("completion rechecks destination access and expired reservations", async () => {
    const root = await create({ visibility: "workspace" });
    const reserved = fileUploadResponseSchema.parse(
      await run(
        "reserve",
        {
          name: "Revoked.txt",
          parentId: root.id,
          mimeType: "text/plain",
          size: 4,
        },
        member,
      ),
    );
    await run(
      "upload-bytes",
      {
        uploadId: reserved.uploadId,
        dataBase64: Buffer.from("test").toString("base64"),
      },
      member,
    );
    await run("update", {
      id: root.id,
      expectedSyncId: root.syncId,
      access: { visibility: "private", grants: [] },
    });
    await expect(
      run("complete", { uploadId: reserved.uploadId }, member),
    ).rejects.toMatchObject({ status: 404 });
    await local.db
      .update(s.fileUpload)
      .set({ expiresAt: new Date(0) })
      .where(eq(s.fileUpload.id, reserved.uploadId));
    await expect(
      run("complete", { uploadId: reserved.uploadId }, member),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("invalid UTF-8 Markdown stays downloadable while unrelated read failures propagate", async () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x41]);
    const reserved = fileUploadResponseSchema.parse(
      await run("reserve", {
        name: "Legacy encoding.md",
        mimeType: "text/markdown",
        size: bytes.length,
      }),
    );
    await run("upload-bytes", {
      uploadId: reserved.uploadId,
      dataBase64: bytes.toString("base64"),
    });
    const uploaded = fileMutationSchema.parse(
      await run("complete", { uploadId: reserved.uploadId }),
    ).entries[0];
    expect(uploaded.kind).toBe("file");
    const download = (await run("download", { id: uploaded.id })) as {
      url: string;
    };
    expect(await readLocalObject(download.url.slice(6))).toEqual(
      new Uint8Array(bytes),
    );

    const pending = fileUploadResponseSchema.parse(
      await run("reserve", {
        name: "Read failure.md",
        mimeType: "text/markdown",
        size: 1,
      }),
    );
    await run("upload-bytes", {
      uploadId: pending.uploadId,
      dataBase64: Buffer.from("x").toString("base64"),
    });
    const context = await fileScope(local.db, owner, scope, true);
    await expect(
      completeFileUpload(
        context,
        { uploadId: pending.uploadId },
        {
          ...objectStorage(),
          readText: async () => {
            throw new TypeError("Network read failed");
          },
        },
      ),
    ).rejects.toThrow("Network read failed");
    const completed = fileMutationSchema.parse(
      await run("complete", { uploadId: pending.uploadId }),
    ).entries[0];
    expect(completed.kind).toBe("markdown");
  });

  test.each(["access", "expiry"])(
    "slow sealing permits other writes and rechecks %s before completion",
    async (change) => {
      const folder = await create({ visibility: "workspace" });
      const reserved = fileUploadResponseSchema.parse(
        await run(
          "reserve",
          {
            name: `Delayed ${change}.txt`,
            mimeType: "text/plain",
            size: 1,
            parentId: folder.id,
          },
          member,
        ),
      );
      await run(
        "upload-bytes",
        {
          uploadId: reserved.uploadId,
          dataBase64: Buffer.from("x").toString("base64"),
        },
        member,
      );
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const storage = objectStorage();
      const context = await fileScope(local.db, member, scope, true);
      const completing = completeFileUpload(
        context,
        { uploadId: reserved.uploadId },
        {
          ...storage,
          sealUpload: async (...args) => {
            started.resolve();
            await release.promise;
            await storage.sealUpload(...args);
          },
        },
      );
      const result = completing.then(
        () => null,
        (error: unknown) => error,
      );
      await started.promise;
      try {
        await create({ name: randomUUID() });
        if (change === "access")
          await run("update", {
            id: folder.id,
            expectedSyncId: folder.syncId,
            access: { visibility: "private", grants: [] },
          });
        else
          await local.db
            .update(s.fileUpload)
            .set({ expiresAt: new Date(0) })
            .where(eq(s.fileUpload.id, reserved.uploadId));
      } finally {
        release.resolve();
      }
      expect(await result).toMatchObject({
        status: change === "access" ? 404 : 409,
      });
    },
  );
});
