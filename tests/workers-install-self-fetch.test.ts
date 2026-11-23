import { afterAll, expect, test, vi } from "vitest";

const native = globalThis.fetch;
afterAll(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: native,
  });
});

test("self requests use SELF even after the framework replaces fetch", async () => {
  const { bindSelf } = await import("../worker/install-self-fetch");
  const self = { fetch: vi.fn(() => Promise.resolve(new Response("self"))) };
  bindSelf(
    self,
    "https://gravity.example.com",
    "https://gravity.example.com/mcp",
  );
  const framework = vi.fn(() => Promise.resolve(new Response("network")));
  globalThis.fetch = framework;

  const own = await globalThis.fetch(
    "https://gravity.example.com/api/auth/jwks",
  );
  const other = await globalThis.fetch("https://api.example.org/v1");

  expect(await own.text()).toBe("self");
  expect(await other.text()).toBe("network");
  expect(self.fetch).toHaveBeenCalledTimes(1);
  expect(framework).toHaveBeenCalledTimes(1);
});
