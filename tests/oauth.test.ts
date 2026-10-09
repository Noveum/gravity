import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  Client,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { flowKey, withOAuthRequest } from "../packages/auth/flow";
import { authPlugins } from "../packages/auth/options";
import { CrmService } from "../packages/core/crm";
import { errorResponse } from "../packages/core/http";
import { createLocalDatabase } from "../packages/database/client";
import * as schema from "../packages/database/schema";
import {
  principalForGrant,
  principalForVerifiedToken,
} from "../packages/mcp/server";

vi.mock("@crm/auth/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuth: async () => auth,
}));
vi.mock("@crm/database/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDatabase: async () => local.db,
}));

import { POST as mcpPost } from "../src/app/mcp/route";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let auth: ReturnType<typeof createTestAuth>;
let origin: string;
let cookie = "";
let userId: string;
let sessionId: string;
const server = createServer(async (incoming, outgoing) => {
  try {
    const bytes: Uint8Array[] = [];
    for await (const chunk of incoming) bytes.push(chunk);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (value) headers.set(key, value);
    }
    const request = new Request(`${origin}${incoming.url}`, {
      method: incoming.method,
      headers,
      ...(incoming.method === "POST" ? { body: Buffer.concat(bytes) } : {}),
    });
    let response: Response;
    if (incoming.url?.startsWith("/mcp") && incoming.method !== "POST")
      response = new Response(null, {
        status: 405,
        headers: { Allow: "POST" },
      });
    else if (incoming.url?.startsWith("/mcp"))
      response = await mcpPost(request);
    else
      response = await withOAuthRequest(request, () => auth.handler(request));
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key !== "set-cookie") outgoing.setHeader(key, value);
    });
    outgoing.setHeader("set-cookie", response.headers.getSetCookie());
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const response = errorResponse(error);
    outgoing.statusCode = response.status;
    outgoing.end(await response.text());
  }
});
async function call(path: string, body?: object, session = true) {
  const response = await fetch(`${origin}/api/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: origin,
      ...(session ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const newCookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]);
  if (session && newCookies.length) {
    const jar = new Map(
      cookie
        .split("; ")
        .filter(Boolean)
        .map((value) => [value.split("=")[0], value]),
    );
    for (const value of newCookies) jar.set(value.split("=")[0], value);
    cookie = [...jar.values()].join("; ");
  }
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text);
  } catch {}
  return {
    response,
    payload,
    url: String(payload.url ?? response.headers.get("location") ?? ""),
  };
}
function createTestAuth() {
  return betterAuth({
    baseURL: origin,
    secret: randomBytes(32).toString("hex"),
    database: drizzleAdapter(local.db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    plugins: authPlugins(local.db),
    rateLimit: { enabled: false },
  });
}
beforeAll(async () => {
  local = await createLocalDatabase();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_SERVER_ERROR");
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("APP_URL", origin);
  auth = createTestAuth();
  const signup = await call("/sign-up/email", {
    name: "OAuth test user",
    email: "oauth@example.test",
    password: randomBytes(24).toString("hex"),
  });
  expect(signup.response.status).toBe(200);
  const identity = await auth.api.getSession({
    headers: new Headers({ Cookie: cookie }),
  });
  if (!identity) throw new Error("TEST_SESSION_ERROR");
  userId = identity.user.id;
  sessionId = identity.session.id;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await local.client.close();
  vi.unstubAllEnvs();
});
test("OAuth PKCE binds each simultaneous flow to its own organization and product grant", async () => {
  const service = new CrmService(local.db);
  const principal = { userId, source: "session" as const };
  const orgA = await service.createOrganization(principal, "OAuth Org A");
  const orgB = await service.createOrganization(principal, "OAuth Org B");
  const productA = await service.createProduct(principal, orgA.id, "A Product");
  const productB = await service.createProduct(principal, orgB.id, "B Product");
  const registration = await call(
    "/oauth2/register",
    {
      application_type: "native",
      client_name: "Test assistant",
      redirect_uris: [`${origin}/callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid offline_access crm:read crm:write crm:send",
    },
    false,
  );
  expect(
    registration.response.status,
    JSON.stringify({
      error: registration.payload.error,
      description: registration.payload.error_description,
    }),
  ).toBe(201);
  const clientId = String(registration.payload.client_id);
  const verifierA = randomBytes(32).toString("base64url");
  const verifierB = randomBytes(32).toString("base64url");
  const query = (verifier: string, state: string) =>
    new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: `${origin}/callback`,
      scope: "openid offline_access crm:read crm:write crm:send",
      resource: `${origin}/mcp`,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
  const startA = await call(`/oauth2/authorize?${query(verifierA, "flow-a")}`);
  const startB = await call(`/oauth2/authorize?${query(verifierB, "flow-b")}`);
  expect(startA.url).toContain("/authorize?");
  expect(startB.url).toContain("/authorize?");
  const signedA = new URL(startA.url, origin).search.slice(1);
  const signedB = new URL(startB.url, origin).search.slice(1);
  const [grantA] = await local.db
    .insert(schema.mcpGrants)
    .values({ organizationId: orgA.id, userId, productIds: [productA.id] })
    .returning();
  const [grantB] = await local.db
    .insert(schema.mcpGrants)
    .values({ organizationId: orgB.id, userId, productIds: [productB.id] })
    .returning();
  await local.db.insert(schema.oauthSelections).values([
    { sessionId, flowKey: flowKey(signedA), grantId: grantA.id },
    { sessionId, flowKey: flowKey(signedB), grantId: grantB.id },
  ]);
  const continueA = await call("/oauth2/continue", {
    postLogin: true,
    oauth_query: signedA,
  });
  const continueB = await call("/oauth2/continue", {
    postLogin: true,
    oauth_query: signedB,
  });
  expect(continueA.url).toContain("/consent?");
  expect(continueB.url).toContain("/consent?");
  const consentA = await call("/oauth2/consent", {
    accept: true,
    oauth_query: new URL(continueA.url, origin).search.slice(1),
  });
  expect(consentA.url).toContain("/callback?");
  const code = new URL(consentA.url).searchParams.get("code");
  expect(code).toBeTruthy();
  const tokenResponse = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code ?? "",
      redirect_uri: `${origin}/callback`,
      code_verifier: verifierA,
      resource: `${origin}/mcp`,
    }),
  });
  expect(tokenResponse.status).toBe(200);
  const token = await tokenResponse.json();
  const claims = JSON.parse(
    Buffer.from(
      String(token.access_token).split(".")[1],
      "base64url",
    ).toString(),
  );
  expect(claims.crm_grant_id).toBe(grantA.id);
  expect(await principalForVerifiedToken(local.db, claims)).toMatchObject({
    clientId: claims.client_id,
    grantId: grantA.id,
  });
  expect((await principalForVerifiedToken(local.db, claims)).readOnly).toBe(
    false,
  );
  expect((await principalForVerifiedToken(local.db, claims)).canSend).toBe(
    true,
  );
  expect(
    (
      await principalForVerifiedToken(local.db, {
        ...claims,
        scope: "crm:read crm:write",
      })
    ).canSend,
  ).toBe(false);
  expect(
    (
      await principalForVerifiedToken(local.db, {
        ...claims,
        scope: "crm:read",
      })
    ).readOnly,
  ).toBe(true);
  expect([claims.aud].flat()).toContain(`${origin}/mcp`);
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_products", arguments: {} },
    }),
  });
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain("A Product");
  expect(body).not.toContain("B Product");
  // Accept a narrower scope on a second flow; a valid legacy read-only token must not gain writes.
  const readConsent = await call("/oauth2/consent", {
    accept: true,
    scope: "crm:read",
    oauth_query: new URL(continueB.url, origin).search.slice(1),
  });
  const readTokenResponse = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: new URL(readConsent.url).searchParams.get("code") ?? "",
      redirect_uri: `${origin}/callback`,
      code_verifier: verifierB,
      resource: `${origin}/mcp`,
    }),
  });
  expect(readTokenResponse.status).toBe(200);
  const readToken = await readTokenResponse.json();
  const readOnlyList = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${readToken.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(readOnlyList.status).toBe(200);
  const readOnlyTools = await readOnlyList.text();
  expect(readOnlyTools).toContain('"list_products"');
  expect(readOnlyTools).not.toContain('"create_person"');
  expect(readOnlyTools).not.toContain('"send_touch"');
  const refreshed = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: token.refresh_token,
      resource: `${origin}/mcp`,
    }),
  });
  expect(refreshed.status).toBe(200);
  const refreshToken = await refreshed.json();
  const refreshedClaims = JSON.parse(
    Buffer.from(
      String(refreshToken.access_token).split(".")[1],
      "base64url",
    ).toString(),
  );
  expect(refreshedClaims.crm_grant_id).toBe(grantA.id);
  await local.db
    .update(schema.oauthClient)
    .set({ disabled: true })
    .where(eq(schema.oauthClient.clientId, clientId));
  await expect(
    principalForVerifiedToken(local.db, claims),
  ).rejects.toMatchObject({ status: 401 });
  await expectAuthenticationRecovery(token.access_token);
  await local.db
    .update(schema.oauthClient)
    .set({ disabled: false })
    .where(eq(schema.oauthClient.clientId, clientId));
  await local.db
    .update(schema.session)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.session.id, sessionId));
  await expect(
    principalForVerifiedToken(local.db, claims),
  ).rejects.toMatchObject({ status: 401 });
  await expectAuthenticationRecovery(token.access_token);
  await local.db
    .update(schema.session)
    .set({ expiresAt: new Date(Date.now() + 86400000) })
    .where(eq(schema.session.id, sessionId));
  await local.db
    .update(schema.mcpGrants)
    .set({ active: false })
    .where(eq(schema.mcpGrants.id, grantA.id));
  await expect(
    principalForGrant(local.db, userId, claims.crm_grant_id),
  ).rejects.toMatchObject({ status: 403 });
  const revoked = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  expect(revoked.status).toBe(403);
  expect(revoked.headers.has("www-authenticate")).toBe(false);
});

async function expectAuthenticationRecovery(accessToken: string) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
  const challenge = response.headers.get("www-authenticate") ?? "";
  expect(challenge).toContain('error="invalid_token"');
  expect(challenge).toContain('scope="crm:read crm:write crm:send"');
  expect(challenge).toContain(
    `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
  );
  const metadata = await fetch(
    `${origin}/.well-known/oauth-protected-resource/mcp`,
  );
  expect(metadata.status).toBe(200);
  expect(await metadata.json()).toMatchObject({ resource: `${origin}/mcp` });
}
test("an MCP token without crm:read is refused with insufficient_scope", async () => {
  const service = new CrmService(local.db);
  const organization = await service.createOrganization(
    { userId, source: "session" },
    "OAuth Scope Org",
  );
  const registration = await call(
    "/oauth2/register",
    {
      application_type: "native",
      client_name: "Scope test assistant",
      redirect_uris: [`${origin}/callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid offline_access crm:read",
    },
    false,
  );
  expect(registration.response.status).toBe(201);
  const clientId = String(registration.payload.client_id);
  const verifier = randomBytes(32).toString("base64url");
  const start = await call(
    `/oauth2/authorize?${new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: `${origin}/callback`,
      scope: "openid offline_access crm:read",
      resource: `${origin}/mcp`,
      state: "scope-flow",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    })}`,
  );
  const signed = new URL(start.url, origin).search.slice(1);
  const [grant] = await local.db
    .insert(schema.mcpGrants)
    .values({ organizationId: organization.id, userId, productIds: ["*"] })
    .returning();
  await local.db
    .insert(schema.oauthSelections)
    .values({ sessionId, flowKey: flowKey(signed), grantId: grant.id });
  const proceed = await call("/oauth2/continue", {
    postLogin: true,
    oauth_query: signed,
  });
  const consent = await call("/oauth2/consent", {
    accept: true,
    scope: "openid offline_access",
    oauth_query: new URL(proceed.url, origin).search.slice(1),
  });
  const tokenResponse = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: new URL(consent.url).searchParams.get("code") ?? "",
      redirect_uri: `${origin}/callback`,
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    }),
  });
  expect(tokenResponse.status).toBe(200);
  const token = await tokenResponse.json();
  expect(String(token.scope ?? "")).not.toContain("crm:read");
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toContain(
    "insufficient_scope",
  );
});
test("MCP requests without credentials receive OAuth discovery instead of data", async () => {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain(
    "resource_metadata",
  );
  const header = response.headers.get("www-authenticate") ?? "";
  expect(header).toContain('scope="crm:read crm:write crm:send"');
  const url = header.match(/resource_metadata="([^"]+)"/)?.[1];
  expect(url).toBeTruthy();
  const metadataResponse = await fetch(url ?? "");
  expect(metadataResponse.status).toBe(200);
  const metadata = await metadataResponse.json();
  expect(metadata.resource).toBe(`${origin}/mcp`);
  expect(metadata.scopes_supported).toContain("crm:read");
  expect(metadata.scopes_supported).toContain("crm:write");
  const issuer = new URL(metadata.authorization_servers[0]);
  const discovery = await fetch(
    `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`,
  );
  expect(discovery.status).toBe(200);
  const configuration = await discovery.json();
  expect(configuration.issuer).toBe(metadata.authorization_servers[0]);
  expect(configuration.code_challenge_methods_supported).toContain("S256");
});

test.each(["https://untrusted.example.test", "null"])(
  "MCP rejects the invalid browser Origin %s without a login challenge",
  async (requestOrigin) => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        Origin: requestOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(await response.json()).toEqual({ error: "FORBIDDEN" });
  },
);

test("MCP accepts its configured browser Origin and returns OAuth discovery", async () => {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain(
    "resource_metadata",
  );
});

test("official MCP client discovers OAuth, registers, completes PKCE and reads and writes only its selected product", async () => {
  const service = new CrmService(local.db);
  const principal = { userId, source: "session" as const };
  const organization = await service.createOrganization(principal, "SDK Org");
  const product = await service.createProduct(
    principal,
    organization.id,
    "SDK Selected Product",
  );
  const hiddenProduct = await service.createProduct(
    principal,
    organization.id,
    "SDK Hidden Product",
  );
  let clientInformation: StoredOAuthClientInformation | undefined;
  let tokens: StoredOAuthTokens | undefined;
  let verifier = "";
  let authorizationUrl: URL | undefined;
  let discoveryState: OAuthDiscoveryState | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: `${origin}/sdk-callback`,
    clientMetadata: {
      client_name: "Fictional SDK assistant",
      redirect_uris: [`${origin}/sdk-callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "crm:read crm:write crm:send offline_access",
    },
    state: () => "sdk-state",
    clientInformation: () => clientInformation,
    saveClientInformation: (value) => {
      clientInformation = value;
    },
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value;
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    discoveryState: () => discoveryState,
    saveDiscoveryState: (value) => {
      discoveryState = value;
    },
    redirectToAuthorization: (url) => {
      authorizationUrl = url;
    },
  };
  const transport = new StreamableHTTPClientTransport(
    new URL(`${origin}/mcp`),
    { authProvider: provider },
  );
  const client = new Client({
    name: "gravity-sdk-qualification",
    version: "1.0.0",
  });
  try {
    await expect(client.connect(transport)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(clientInformation?.client_id).toBeTruthy();
    expect(authorizationUrl).toBeDefined();
    if (!authorizationUrl) throw new Error("TEST_AUTHORIZATION_MISSING");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorizationUrl.searchParams.get("resource")).toBe(`${origin}/mcp`);
    const start = await call(
      authorizationUrl.pathname.replace("/api/auth", "") +
        authorizationUrl.search,
    );
    expect(start.url).toContain("/authorize?");
    const signed = new URL(start.url, origin).search.slice(1);
    const [grant] = await local.db
      .insert(schema.mcpGrants)
      .values({
        organizationId: organization.id,
        userId,
        productIds: [product.id],
      })
      .returning();
    await local.db
      .insert(schema.oauthSelections)
      .values({ sessionId, flowKey: flowKey(signed), grantId: grant.id });
    const continued = await call("/oauth2/continue", {
      postLogin: true,
      oauth_query: signed,
    });
    const consent = await call("/oauth2/consent", {
      accept: true,
      oauth_query: new URL(continued.url, origin).search.slice(1),
    });
    const callback = new URL(consent.url);
    expect(callback.searchParams.get("state")).toBe("sdk-state");
    await transport.finishAuth(callback.searchParams);
    expect(tokens?.access_token).toBeTruthy();
  } finally {
    await client.close();
  }
  const connected = new Client({
    name: "gravity-sdk-qualification",
    version: "1.0.0",
  });
  const authenticatedTransport = new StreamableHTTPClientTransport(
    new URL(`${origin}/mcp`),
    { authProvider: provider },
  );
  try {
    await connected.connect(authenticatedTransport);
    const tools = await connected.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("list_products");
    expect(
      tools.tools.find((tool) => tool.name === "get_agent_guide")?.outputSchema
        ?.type,
    ).toBe("object");
    const guide = await connected.callTool({
      name: "get_agent_guide",
      arguments: { topic: "sequences" },
    });
    expect(guide.isError).not.toBe(true);
    expect(guide.structuredContent).toMatchObject({
      topic: "sequences",
      steps: expect.any(Array),
    });
    expect(
      tools.tools.some(
        (tool) =>
          tool.name === "create_person" &&
          tool.annotations?.readOnlyHint === false,
      ),
    ).toBe(true);
    const products = await connected.callTool({
      name: "list_products",
      arguments: {},
    });
    expect(JSON.stringify(products)).toContain("SDK Selected Product");
    expect(JSON.stringify(products)).not.toContain("SDK Hidden Product");
    const forbidden = await connected.callTool({
      name: "list_next_actions",
      arguments: { productId: hiddenProduct.id },
    });
    expect(forbidden.isError).toBe(true);
    expect(JSON.stringify(forbidden)).toContain("FORBIDDEN");
    const created = await connected.callTool({
      name: "create_person",
      arguments: {
        productId: product.id,
        name: "Fictional OAuth buyer",
        review: false,
      },
    });
    expect(created.isError).not.toBe(true);
    expect(
      (
        await service.snapshot(principal, {
          organizationId: organization.id,
          productId: product.id,
        })
      ).people.some((p) => p.name === "Fictional OAuth buyer"),
    ).toBe(true);
    const deniedWrite = await connected.callTool({
      name: "create_person",
      arguments: {
        productId: hiddenProduct.id,
        name: "Forbidden OAuth buyer",
        review: false,
      },
    });
    expect(deniedWrite.isError).toBe(true);
    expect(JSON.stringify(deniedWrite)).toContain("FORBIDDEN");
    const capabilities = await connected.callTool({
      name: "get_capabilities",
      arguments: {},
    });
    expect(capabilities.isError).not.toBe(true);
    await local.db
      .update(schema.mcpGrants)
      .set({ active: false })
      .where(eq(schema.mcpGrants.userId, userId));
    await expect(
      connected.callTool({ name: "list_products", arguments: {} }),
    ).rejects.toThrow();
  } finally {
    await connected.close();
  }
});
