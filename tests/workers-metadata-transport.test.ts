import { afterEach, expect, test, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

async function transport(runtime: "workers" | "node") {
  vi.resetModules();
  if (runtime === "workers")
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  return (await import("../packages/auth/metadata-transport"))
    .metadataTransport;
}
function answering(status: number) {
  const fetched = vi.fn(
    async (_request: Request) => new Response(null, { status }),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  lookup.mockReset();
});

test("on Workers a client metadata fetch returns a redirect unfollowed, in a mode Workers accepts", async () => {
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  const fetched = answering(301);
  const response = await (await transport("workers"))(
    "https://client.example.test/metadata.json",
    // The plugin asks for "error", which Workers refuses before sending.
    { headers: { Accept: "application/json" }, redirect: "error" },
  );
  expect(response.status).toBe(301);
  const request = fetched.mock.calls[0][0];
  expect(request.redirect).toBe("manual");
  expect(request.headers.get("accept")).toBe("application/json");
  expect(lookup).toHaveBeenCalledWith("client.example.test", {
    all: true,
    verbatim: true,
  });
});

test("on Workers a hostname with any non-public answer is refused before a request is made", async () => {
  const fetched = answering(200);
  const fetchMetadata = await transport("workers");
  for (const answers of [
    [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ],
    [{ address: "169.254.169.254", family: 4 }],
    [{ address: "::1", family: 6 }],
    [],
  ]) {
    lookup.mockResolvedValue(answers);
    await expect(
      fetchMetadata("https://client.example.test/metadata.json"),
    ).rejects.toThrow(TypeError);
  }
  // A public answer leaves the scheme as the only reason to refuse.
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  await expect(
    fetchMetadata("http://client.example.test/metadata.json"),
  ).rejects.toThrow(TypeError);
  expect(fetched).not.toHaveBeenCalled();
});

test("off Workers the pinned Node transport is kept", async () => {
  const selected = await transport("node");
  const { fetchClientMetadataResource } = await import(
    "@better-auth/cimd/node"
  );
  expect(selected).toBe(fetchClientMetadataResource);
});
