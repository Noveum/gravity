import { selfRoutingFetch } from "./self-fetch";

interface Fetcher {
  fetch: typeof fetch;
}

let self: Fetcher | undefined;
const appOrigins = new Set<string>();
const route = (next: typeof fetch) =>
  selfRoutingFetch(next.bind(globalThis), () => self, appOrigins);
let routed = route(globalThis.fetch);
// vinext replaces globalThis.fetch with its caching fetch on the first
// request. Wrap whatever is assigned so self requests still use SELF.
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  enumerable: true,
  get: () => routed,
  set: (next: typeof fetch) => {
    routed = route(next);
  },
});

export function bindSelf(binding: Fetcher | undefined, ...urls: unknown[]) {
  self = binding;
  for (const url of urls)
    if (typeof url === "string" && URL.canParse(url))
      appOrigins.add(new URL(url).origin);
}
