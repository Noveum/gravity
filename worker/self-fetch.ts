type Fetch = typeof fetch;
interface Fetcher {
  fetch: Fetch;
}

// A Worker cannot reach its own custom domain over the network: Cloudflare
// answers 522. Requests for one of the app's own origins, such as the OAuth
// JWKS that MCP token checks load, go through the SELF service binding.
export function selfRoutingFetch(
  network: Fetch,
  self: () => Fetcher | undefined,
  origins: ReadonlySet<string>,
): Fetch {
  return (input, init) => {
    const binding = self();
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    return binding && URL.canParse(url) && origins.has(new URL(url).origin)
      ? binding.fetch(input, init)
      : network(input, init);
  };
}
