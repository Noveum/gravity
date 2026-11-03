import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Database } from "../packages/database/client";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let db: Database;
let userId = demoUser;
vi.mock("@crm/database/client", async (original) => ({
  ...(await original<object>()),
  getDatabase: async () => db,
}));
vi.mock("@crm/auth/server", () => ({
  currentPrincipal: async () => ({ userId, source: "session" }),
}));

import { GET } from "../src/app/api/materials/route";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const key = randomUUID();
let assetId: string;
beforeAll(async () => {
  local = await createLocalDatabase();
  db = local.db;
  await seedDemo(db);
  await mkdir(resolve(".data/files"), { recursive: true });
  await writeFile(resolve(".data/files", key), "Fictional legacy material");
  const [asset] = await db
    .insert(s.assets)
    .values({
      organizationId: demoId(1),
      productId: demoId(10),
      folderId: demoId(900),
      name: "Legacy.md",
      storageKey: key,
      mimeType: "text/markdown",
      size: 24,
      sha256: "0".repeat(64),
      uploadedBy: demoUser,
    })
    .returning();
  assetId = asset.id;
});
afterAll(async () => {
  await local.client.close();
  await rm(resolve(".data/files", key), { force: true });
});
function request() {
  return new Request(
    `http://localhost/api/materials?organizationId=${demoId(1)}&assetId=${assetId}`,
  );
}
test("legacy UUID materials download through the authorized HTTP reader", async () => {
  userId = demoUser;
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Fictional legacy material");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
test("the same legacy HTTP path enforces current product access", async () => {
  userId = "demo-restricted";
  expect((await GET(request())).status).toBe(403);
});
