import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { objectStorage } from "../packages/files/storage";

const accessKey = "fictional-signing-access";
const secret = "fictional-signing-secret";
const key =
  "00000000-0000-4000-8000-000000000001/pending/00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CRM_DEMO_MODE", "false");
  vi.stubEnv("S3_BUCKET", "fictional-signing-bucket");
  vi.stubEnv("S3_REGION", "auto");
  vi.stubEnv("S3_ENDPOINT", "https://fictional-storage.invalid:9443");
  vi.stubEnv("S3_ACCESS_KEY_ID", accessKey);
  vi.stubEnv("S3_SECRET_ACCESS_KEY", secret);
});
afterEach(() => vi.unstubAllEnvs());

const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// Independent SigV4 verification catches SDK endpoint, canonicalization and
// signed-header regressions without contacting a provider or mocking the signer.
function signature(url: URL, method: string, headers: Record<string, string>) {
  const query = url.searchParams;
  const credential = query.get("X-Amz-Credential")?.split("/") ?? [];
  const [, date, region, service, terminator] = credential;
  const scope = [date, region, service, terminator].join("/");
  const signedHeaders = query.get("X-Amz-SignedHeaders") ?? "";
  const canonicalQuery = [...query]
    .filter(([name]) => name !== "X-Amz-Signature")
    .map(([name, value]) => [encode(name), encode(value)])
    .sort(([a, av], [b, bv]) =>
      a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1,
    )
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    signedHeaders
      .split(";")
      .map((name) => `${name}:${headers[name]}\n`)
      .join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    query.get("X-Amz-Date"),
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  let signingKey: string | Buffer = `AWS4${secret}`;
  for (const part of [date, region, service, terminator])
    signingKey = createHmac("sha256", signingKey).update(part).digest();
  return createHmac("sha256", signingKey).update(stringToSign).digest("hex");
}

test("production upload signs the scoped key, endpoint port and exact length without optional checksums", async () => {
  const url = new URL(await objectStorage().uploadUrl(key, "text/plain", 27));
  expect(url.origin).toBe("https://fictional-storage.invalid:9443");
  expect(url.pathname).toBe(`/fictional-signing-bucket/${key}`);
  expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  expect(url.searchParams.get("X-Amz-Credential")).toMatch(
    new RegExp(`^${accessKey}/\\d{8}/auto/s3/aws4_request$`),
  );
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
    "content-length;host",
  );
  expect(url.searchParams.get("X-Amz-Content-Sha256")).toBe("UNSIGNED-PAYLOAD");
  expect(
    [...url.searchParams.keys()].some((name) => /checksum/i.test(name)),
  ).toBe(false);
  const headers = { host: url.host, "content-length": "27" };
  expect(signature(url, "PUT", headers)).toBe(
    url.searchParams.get("X-Amz-Signature"),
  );
  expect(
    signature(url, "PUT", { ...headers, "content-length": "28" }),
  ).not.toBe(url.searchParams.get("X-Amz-Signature"));
  url.pathname = url.pathname.replace("000000000001", "000000000099");
  expect(signature(url, "PUT", headers)).not.toBe(
    url.searchParams.get("X-Amz-Signature"),
  );
});

test.each([false, true])(
  "download signatures preserve private response overrides and encoded names (preview=%s)",
  async (preview) => {
    const name = "Fictional € report #1?.txt";
    const url = new URL(
      await objectStorage().downloadUrl(key, name, preview, "text/plain"),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-cache-control")).toBe(
      "private, no-store",
    );
    expect(url.searchParams.get("response-content-type")).toBe(
      preview ? "text/plain" : "application/octet-stream",
    );
    expect(url.searchParams.get("response-content-disposition")).toBe(
      `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    expect(signature(url, "GET", { host: url.host })).toBe(
      url.searchParams.get("X-Amz-Signature"),
    );
    url.searchParams.set("response-cache-control", "public");
    expect(signature(url, "GET", { host: url.host })).not.toBe(
      url.searchParams.get("X-Amz-Signature"),
    );
  },
);

test("changing the configured provider rebuilds the client and AWS endpoints use the current region", async () => {
  const custom = new URL(await objectStorage().uploadUrl(key, "text/plain", 1));
  vi.stubEnv("S3_ENDPOINT", "");
  vi.stubEnv("S3_REGION", "eu-west-1");
  const aws = new URL(await objectStorage().uploadUrl(key, "text/plain", 1));
  expect(aws.host).toBe("fictional-signing-bucket.s3.eu-west-1.amazonaws.com");
  expect(aws.pathname).toBe(`/${key}`);
  expect(aws.searchParams.get("X-Amz-Credential")).toContain(
    "/eu-west-1/s3/aws4_request",
  );
  expect(signature(aws, "PUT", { host: aws.host, "content-length": "1" })).toBe(
    aws.searchParams.get("X-Amz-Signature"),
  );
  expect(aws.host).not.toBe(custom.host);
});
