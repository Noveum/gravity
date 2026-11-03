import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { objectStorage } from "../packages/files/storage";
import {
  completeAssetUpload,
  reserveAssetUpload,
} from "../packages/storage/files";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const owner = { userId: demoUser, source: "session" as const };
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => local.client.close());

async function withProvider(
  bytes: Uint8Array,
  action: (
    storage: ReturnType<typeof objectStorage>,
    requests: { method: string; path: string; condition?: string }[],
  ) => Promise<void>,
) {
  const objects = new Map<string, Uint8Array>();
  const requests: { method: string; path: string; condition?: string }[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    requests.push({
      method: req.method ?? "",
      path,
      condition: String(req.headers["x-amz-copy-source-if-match"] ?? ""),
    });
    if (req.method === "HEAD") {
      objects.set(path, bytes);
      res.setHeader("ETag", '"source-version"');
      res.setHeader("Content-Length", bytes.length);
      res.end();
    } else if (req.method === "PUT") {
      const source = decodeURIComponent(
        String(req.headers["x-amz-copy-source"]),
      );
      objects.set(path, new Uint8Array(objects.get(`/${source}`) ?? []));
      // Pending uploads remain mutable after sealing; validation must read the target.
      objects.set(`/${source}`, Buffer.from("replacement"));
      res.setHeader("Content-Type", "application/xml");
      res.end(
        '<CopyObjectResult><ETag>"target-version"</ETag><LastModified>2026-11-03T00:00:00Z</LastModified></CopyObjectResult>',
      );
    } else if (req.method === "GET") {
      res.setHeader("ETag", '"target-version"');
      res.setHeader("Transfer-Encoding", "chunked");
      const body = objects.get(path) ?? new Uint8Array();
      for (let i = 0; i < body.length; i += 2)
        res.write(body.subarray(i, i + 2));
      res.end();
    } else {
      res.statusCode = 405;
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Provider unavailable");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CRM_DEMO_MODE", "false");
  vi.stubEnv("S3_BUCKET", "fictional-materials");
  vi.stubEnv("S3_REGION", "us-east-1");
  vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("S3_ACCESS_KEY_ID", "fictional-key");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "fictional-secret");
  try {
    await action(objectStorage("materials"), requests);
  } finally {
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((e) => (e ? reject(e) : done())),
    );
  }
}

test.each([
  {
    bytes: Buffer.from("invalid-pdf"),
    mimeType: "application/pdf",
    code: "FILE_TYPE",
  },
  {
    bytes: Buffer.from([0x61, 0xe2, 0x82]),
    mimeType: "text/plain",
    code: "FILE_TYPE",
  },
  {
    bytes: Buffer.from("%PDF-1.7 fictional\n%%EOF"),
    mimeType: "application/pdf",
    code: null,
  },
  {
    bytes: Buffer.from("Fictional streamed € material"),
    mimeType: "text/markdown",
    code: null,
  },
])(
  "production adapter verifies sealed $mimeType content ($code)",
  async ({ bytes, mimeType, code }) => {
    await withProvider(bytes, async (storage, requests) => {
      const { uploadId } = await reserveAssetUpload(
        local.db,
        owner,
        {
          organizationId: demoId(1),
          productId: demoId(10),
          folderId: demoId(900),
          stageIds: [],
          name: "Fictional material",
          mimeType,
          size: bytes.length,
        },
        storage,
      );
      const completion = completeAssetUpload(
        local.db,
        owner,
        { organizationId: demoId(1), productId: demoId(10), uploadId },
        storage,
      );
      if (code) await expect(completion).rejects.toMatchObject({ code });
      else {
        const result = await completion;
        const [asset] = await local.db
          .select()
          .from(s.assets)
          .where(eq(s.assets.id, result.id));
        expect(asset.sha256).toBe(
          createHash("sha256").update(bytes).digest("hex"),
        );
      }
      expect(requests.map((r) => r.method)).toEqual(["HEAD", "PUT", "GET"]);
      expect(requests[1].condition).toBe('"source-version"');
      expect(requests[2].path).toContain("/files/");
    });
  },
);
