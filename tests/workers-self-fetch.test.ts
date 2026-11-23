import { expect, test, vi } from "vitest";
import { selfRoutingFetch } from "../worker/self-fetch";

const origins = new Set(["https://gravity.example.com"]);
const ok = () => Promise.resolve(new Response("ok"));

test("requests for the app's own origin go through the SELF binding", async () => {
  const network = vi.fn(ok);
  const self = { fetch: vi.fn(ok) };
  const fetch = selfRoutingFetch(network, () => self, origins);
  await fetch("https://gravity.example.com/api/auth/jwks");
  await fetch(new URL("https://gravity.example.com/mcp"));
  await fetch(new Request("https://gravity.example.com/api/health"));
  expect(self.fetch).toHaveBeenCalledTimes(3);
  expect(network).not.toHaveBeenCalled();
});

test("other origins, and every request without a binding, use the network", async () => {
  const network = vi.fn(ok);
  const self = { fetch: vi.fn(ok) };
  await selfRoutingFetch(
    network,
    () => self,
    origins,
  )("https://api.example.org/v1");
  await selfRoutingFetch(
    network,
    () => self,
    origins,
  )("https://gravity.example.com.attacker.test/jwks");
  await selfRoutingFetch(
    network,
    () => undefined,
    origins,
  )("https://gravity.example.com/api/auth/jwks");
  expect(network).toHaveBeenCalledTimes(3);
  expect(self.fetch).not.toHaveBeenCalled();
});
