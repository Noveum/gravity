import { publicPaths, siteCopy } from "../packages/public-site/content";

const supplied = process.argv[2];
if (!supplied) throw new Error("DEPLOYMENT_ORIGIN_REQUIRED");
const origin = new URL(supplied);
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("DEPLOYMENT_HTTPS_ORIGIN_REQUIRED");
const request = (path: string, init?: RequestInit) =>
  fetch(new URL(path, origin), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });

for (const path of publicPaths) {
  const response = await request(path);
  const html = await response.text();
  if (
    response.status !== 200 ||
    !html.includes('id="public-main"') ||
    (path === "/" && !html.includes(siteCopy.heroTitle))
  )
    throw new Error(`DEPLOYMENT_PUBLIC_PAGE_FAILED: ${path}`);
}
const welcome = await fetch(new URL("/welcome", origin), {
  redirect: "manual",
  signal: AbortSignal.timeout(15000),
});
if (
  welcome.status !== 308 ||
  new URL(welcome.headers.get("location") ?? "", origin).pathname !== "/"
)
  throw new Error("LANDING_REDIRECT_FAILED");
const signIn = await request("/sign-in");
if (signIn.status !== 200 || !(await signIn.text()).includes("gravity-mark"))
  throw new Error("DEPLOYMENT_SIGN_IN_FAILED");
const health = await request("/api/health");
if (health.status !== 200 || (await health.json()).status !== "ready")
  throw new Error("DEPLOYMENT_NOT_READY");
for (const [path, type] of [
  ["/icon.svg", "image/svg+xml"],
  ["/opengraph-image", "image/png"],
  ["/brand/gravity-social.png", "image/png"],
] as const) {
  const response = await request(path);
  if (
    response.status !== 200 ||
    !response.headers.get("content-type")?.includes(type)
  )
    throw new Error(`DEPLOYMENT_ASSET_FAILED: ${path}`);
  await response.arrayBuffer();
}
const protectedResource = await request("/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  }),
});
if (
  protectedResource.status !== 401 ||
  !protectedResource.headers
    .get("www-authenticate")
    ?.includes(`${origin.origin}/.well-known/oauth-protected-resource/mcp`)
)
  throw new Error("DEPLOYMENT_OAUTH_CHALLENGE_FAILED");
console.log(
  `Verified ${publicPaths.length} deployed public pages, sign-in, health, three brand assets and the OAuth MCP challenge at ${origin.origin}.`,
);
