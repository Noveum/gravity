import { randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import { sendSignInCode } from "../packages/auth/email";
import { withOAuthRequest } from "../packages/auth/flow";
import { databaseRateLimit } from "../packages/auth/rate-limit";
import { createAuthForDatabase } from "../packages/auth/server";
import { createLocalDatabase } from "../packages/database/client";
import * as schema from "../packages/database/schema";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let auth: ReturnType<typeof createAuthForDatabase>;
let delivered: { email: string; otp: string }[] = [];
const origin = "http://127.0.0.1:39819";
beforeAll(async () => {
  local = await createLocalDatabase();
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("RESEND_API_KEY", "fictional-test-resend-key");
  vi.stubEnv("EMAIL_FROM", "Gravity <login@example.test>");
  auth = createAuthForDatabase(local.db);
});
beforeEach(async () => {
  delivered = [];
  await local.db.delete(schema.verification);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(String(url)).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init?.body));
    delivered.push({ email: body.to[0], otp: body.text.match(/\b\d{6}\b/)[0] });
    return Response.json({ id: "fictional-provider-message" });
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await local.client.close();
  vi.unstubAllEnvs();
});
function call(path: string, body: object, requestOrigin = origin) {
  const request = new Request(`${origin}/api/auth${path}`, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  return withOAuthRequest(request, () => auth.handler(request));
}
async function requestCode(email: string) {
  const response = await call("/email-otp/send-verification-otp", {
    email,
    type: "sign-in",
  });
  expect(response.status).toBe(200);
  return delivered.at(-1)?.otp ?? "";
}
test("a code proves email ownership, creates a session and cannot be reused", async () => {
  const email = "owner@example.test";
  const otp = await requestCode(email);
  const [stored] = await local.db
    .select()
    .from(schema.verification)
    .where(eq(schema.verification.identifier, `sign-in-otp-${email}`));
  expect(stored.value).not.toContain(otp);
  const result = await call("/sign-in/email-otp", { email, otp });
  expect(result.status).toBe(200);
  const cookie = result.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const identity = await auth.api.getSession({
    headers: new Headers({ Cookie: cookie }),
  });
  expect(identity?.user.email).toBe(email);
  expect(identity?.user.emailVerified).toBe(true);
  expect((await call("/sign-in/email-otp", { email, otp })).status).toBe(400);
});
test("resending too soon neither sends another email nor replaces the usable code", async () => {
  const email = "resend@example.test";
  const otp = await requestCode(email);
  expect(
    (
      await call("/email-otp/send-verification-otp", {
        email: email.toUpperCase(),
        type: "sign-in",
      })
    ).status,
  ).toBe(429);
  expect(delivered).toHaveLength(1);
  expect((await call("/sign-in/email-otp", { email, otp })).status).toBe(200);
});

test("email OTP resumes a signed MCP request at organization selection before any token grant", async () => {
  const registered = await call("/oauth2/register", {
    application_type: "native",
    client_name: "OTP test assistant",
    redirect_uris: [`${origin}/assistant-callback`],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "crm:read",
  });
  expect(registered.status, await registered.clone().text()).toBe(201);
  const { client_id: clientId } = await registered.json();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/assistant-callback`,
    response_type: "code",
    scope: "crm:read",
    resource: `${origin}/mcp`,
    code_challenge: randomBytes(32).toString("base64url"),
    code_challenge_method: "S256",
    state: "otp-request",
  });
  const request = new Request(`${origin}/api/auth/oauth2/authorize?${query}`, {
    headers: { Accept: "text/html" },
  });
  const authorization = await withOAuthRequest(request, () =>
    auth.handler(request),
  );
  expect(authorization.status).toBe(302);
  const signed = new URL(
    authorization.headers.get("location") ?? "",
    origin,
  ).searchParams.toString();
  expect(new URLSearchParams(signed).has("sig")).toBe(true);
  const email = "assistant@example.test",
    otp = await requestCode(email);
  const signedIn = await call("/sign-in/email-otp", {
    email,
    otp,
    oauth_query: signed,
  });
  expect(signedIn.status).toBe(200);
  const redirect = await signedIn.json();
  expect(new URL(redirect.url, origin).pathname).toBe("/authorize");
  expect(redirect.token).toBeUndefined();
});
test("expired codes and exhausted attempts do not create sessions", async () => {
  const email = "expired@example.test";
  const otp = await requestCode(email);
  await local.db
    .update(schema.verification)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.verification.identifier, `sign-in-otp-${email}`));
  expect((await call("/sign-in/email-otp", { email, otp })).status).toBe(400);
  const wrongEmail = "wrong@example.test";
  const correct = await requestCode(wrongEmail);
  const wrong = correct === "000000" ? "111111" : "000000";
  for (let i = 0; i < 3; i++)
    expect(
      (await call("/sign-in/email-otp", { email: wrongEmail, otp: wrong }))
        .status,
    ).toBe(400);
  expect(
    (await call("/sign-in/email-otp", { email: wrongEmail, otp: correct }))
      .status,
  ).toBe(403);
});
test("database limits are atomic across independent limiter instances and reset after expiry", async () => {
  const a = databaseRateLimit(local.db),
    b = databaseRateLimit(local.db);
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? a : b).consume("concurrent", { window: 60, max: 3 }),
    ),
  );
  expect(results.filter((result) => result.allowed)).toHaveLength(3);
  expect(
    results
      .filter((result) => !result.allowed)
      .every((result) => (result.retryAfter ?? 0) > 0),
  ).toBe(true);
  await local.db
    .update(schema.verification)
    .set({ expiresAt: new Date(0) })
    .where(like(schema.verification.id, "gravity-limit:%"));
  expect(await a.consume("concurrent", { window: 60, max: 3 })).toEqual({
    allowed: true,
    retryAfter: null,
  });
});
test("untrusted origins and malformed recipient types cannot dispatch codes", async () => {
  expect(
    (
      await call(
        "/email-otp/send-verification-otp",
        { email: "cross-origin@example.test", type: "sign-in" },
        "https://elsewhere.example",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call("/email-otp/send-verification-otp", {
        email: 123,
        type: "sign-in",
      })
    ).status,
  ).toBe(400);
  expect(delivered).toEqual([]);
});
test("provider rejection is recoverable and logs contain no code, address or key", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ message: "private provider body" }, { status: 403 }),
  );
  await expect(
    sendSignInCode({ email: "private@example.test", otp: "654321" }),
  ).rejects.toMatchObject({ statusCode: 503 });
  const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(logs).toContain("gravity.auth_email");
  for (const privateValue of [
    "private@example.test",
    "654321",
    "fictional-test-resend-key",
    "private provider body",
  ])
    expect(logs).not.toContain(privateValue);
});
