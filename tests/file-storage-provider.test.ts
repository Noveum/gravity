import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { objectStorage } from "../packages/files/storage";

afterEach(() => vi.unstubAllEnvs());

async function provider(
  bytes: string,
  action: (
    storage: ReturnType<typeof objectStorage>,
    requests: { method: string; ifMatch: string | undefined }[],
  ) => Promise<void>,
  getEtag = '"sealed-source"',
) {
  const requests: { method: string; ifMatch: string | undefined }[] = [];
  const server = createServer((req, res) => {
    requests.push({
      method: req.method ?? "",
      ifMatch: req.headers["if-match"],
    });
    res.setHeader("ETag", '"sealed-source"');
    if (req.method === "HEAD") res.end();
    else if (req.method === "GET") {
      res.setHeader("ETag", getEtag);
      res.setHeader("Transfer-Encoding", "chunked");
      res.end(bytes);
    } else {
      res.setHeader("Content-Type", "application/xml");
      res.end(
        '<CopyObjectResult><ETag>"sealed-target"</ETag><LastModified>2026-10-06T00:00:00Z</LastModified></CopyObjectResult>',
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Provider not bound");
  vi.stubEnv("CRM_DEMO_MODE", "false");
  vi.stubEnv("S3_BUCKET", "provider-fixture");
  vi.stubEnv("S3_REGION", "us-east-1");
  vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("S3_ACCESS_KEY_ID", "fictional-test-access");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "fictional-test-secret");
  try {
    await action(objectStorage(), requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("S3 provider size verification", () => {
  it("verifies an empty body when HEAD omits Content-Length before copying", async () => {
    await provider("", async (storage, requests) => {
      await storage.sealUpload("source", "final", 0);
      expect(requests.map((request) => request.method)).toEqual([
        "HEAD",
        "GET",
        "PUT",
      ]);
      expect(requests[1]?.ifMatch).toBe('"sealed-source"');
    });
  });

  it("rejects nonempty bytes declared as empty without copying", async () => {
    await provider("unexpected bytes", async (storage, requests) => {
      await expect(
        storage.sealUpload("source", "final", 0),
      ).rejects.toMatchObject({ code: "FILE_SIZE" });
      expect(requests.map((request) => request.method)).toEqual([
        "HEAD",
        "GET",
      ]);
    });
  });

  it("rejects a missing size for a declared nonempty upload", async () => {
    await provider("unexpected bytes", async (storage, requests) => {
      await expect(
        storage.sealUpload("source", "final", 10),
      ).rejects.toMatchObject({ code: "FILE_SIZE" });
      expect(requests.map((request) => request.method)).toEqual(["HEAD"]);
    });
  });

  it("rejects an empty object replaced after the HEAD check", async () => {
    await provider(
      "",
      async (storage, requests) => {
        await expect(
          storage.sealUpload("source", "final", 0),
        ).rejects.toMatchObject({ code: "FILE_SIZE" });
        expect(requests.map((request) => request.method)).toEqual([
          "HEAD",
          "GET",
        ]);
      },
      '"replaced-source"',
    );
  });
});
