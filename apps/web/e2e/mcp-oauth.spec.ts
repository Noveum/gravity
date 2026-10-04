import { createHash, randomBytes } from 'node:crypto';
import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { z } from 'zod';
import { BASE } from './base-url.ts';
import { type E2EFixture, readFixture } from './fixture.ts';
import { signInSession } from './sign-in.ts';

const CALLBACK = 'http://127.0.0.1:47823/callback';
const CLIENT_NAME = 'E2E agent';
const STATE = 'e2e-state';
const REQUESTED_SCOPE = 'openid offline_access gravity.read gravity.write gravity.approve';
const MCP_HEADERS = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
  'mcp-protocol-version': '2025-06-18',
};

const rpcAnswerSchema = z.object({
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ message: z.string() }).optional(),
});
type RpcAnswer = z.infer<typeof rpcAnswerSchema>;

const resourceMetadataSchema = z.object({
  resource: z.string(),
  authorization_servers: z.array(z.string()).min(1),
});

const serverMetadataSchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  registration_endpoint: z.string(),
});

const registrationSchema = z.object({ client_id: z.string().min(1) });
const tokenSchema = z.object({ access_token: z.string().min(1), scope: z.string() });
const oauthErrorSchema = z.object({ error: z.string() });
const serverInfoSchema = z.object({ name: z.string() });
const toolListSchema = z.object({ tools: z.array(z.object({ name: z.string() })) });
const searchResultSchema = z.object({
  people: z.array(z.object({ name: z.string(), url: z.string() })),
});

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function rpc(
  request: APIRequestContext,
  token: string,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<RpcAnswer> {
  const response = await request.post(`${BASE}/mcp`, {
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
    data: { jsonrpc: '2.0', id, method, params },
  });
  expect(response.status()).toBe(200);
  return rpcAnswerSchema.parse(await response.json());
}

interface Captured {
  url: URL | null;
}

interface Flow {
  readonly metadata: z.infer<typeof serverMetadataSchema>;
  readonly resource: string;
  readonly clientId: string;
}

function authorizeParams(flow: Flow, extra: Record<string, string>): URLSearchParams {
  return new URLSearchParams({
    response_type: 'code',
    client_id: flow.clientId,
    redirect_uri: CALLBACK,
    scope: REQUESTED_SCOPE,
    state: STATE,
    resource: flow.resource,
    ...extra,
  });
}

function authorizeUrl(flow: Flow, challenge: string): string {
  const url = new URL(flow.metadata.authorization_endpoint);
  url.search = authorizeParams(flow, {
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

async function expectStartRefused(
  agent: APIRequestContext,
  flow: Flow,
  extra: Record<string, string>,
): Promise<void> {
  const url = new URL(flow.metadata.authorization_endpoint);
  url.search = authorizeParams(flow, extra).toString();
  const response = await agent.get(url.toString(), { maxRedirects: 0 });
  expect(response.status()).toBe(400);
  expect(oauthErrorSchema.parse(await response.json()).error).toBe('invalid_request');
}

function urlOf(captured: Captured): URL | null {
  return captured.url;
}

async function consentAndCapture(
  page: Page,
  captured: Captured,
  url: string,
  workspaceName: string,
): Promise<string> {
  captured.url = null;
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Connect to Gravity' })).toBeVisible();
  await expect(page.getByText(CLIENT_NAME)).toBeVisible();
  await expect(page.getByText('127.0.0.1:47823')).toBeVisible();
  await page.getByLabel('Workspace').selectOption({ label: workspaceName });
  await expect(page.getByLabel('Workspace')).toBeFocused();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => captured.url, { timeout: 15_000 }).not.toBeNull();
  const returned = urlOf(captured);
  expect(returned?.searchParams.get('state')).toBe(STATE);
  const code = returned?.searchParams.get('code') ?? '';
  expect(code).not.toBe('');
  return code;
}

function exchange(agent: APIRequestContext, flow: Flow, code: string, verifier: string) {
  return agent.post(flow.metadata.token_endpoint, {
    form: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: CALLBACK,
      client_id: flow.clientId,
      code_verifier: verifier,
      resource: flow.resource,
    },
  });
}

async function expectRefused(
  response: Awaited<ReturnType<typeof exchange>>,
  status: number,
  error: string,
): Promise<void> {
  expect(response.status()).toBe(status);
  expect(oauthErrorSchema.parse(await response.json()).error).toBe(error);
}

test('an agent connects over OAuth, searches the workspace and loses access when revoked', async ({
  browser,
  playwright,
}) => {
  const fixture = readFixture();
  const context = await browser.newContext();
  const agent = await playwright.request.newContext();
  try {
    await connectAgent(fixture, context, agent);
  } finally {
    await agent.dispose();
    await context.close();
  }
});

async function connectAgent(
  fixture: E2EFixture,
  context: BrowserContext,
  agent: APIRequestContext,
): Promise<void> {
  const anonymous = await agent.post(`${BASE}/mcp`, {
    headers: MCP_HEADERS,
    data: { jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} },
  });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()['www-authenticate']).toContain(
    '/.well-known/oauth-protected-resource/mcp',
  );

  const resource = resourceMetadataSchema.parse(
    await (await agent.get(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json(),
  );
  expect(resource.resource).toBe(`${BASE}/mcp`);
  const issuer = resource.authorization_servers[0] ?? '';
  const metadata = serverMetadataSchema.parse(
    await (await agent.get(`${issuer}/.well-known/oauth-authorization-server`)).json(),
  );
  expect(metadata.authorization_endpoint).toBe(`${BASE}/api/oauth/start`);

  const registered = await agent.post(metadata.registration_endpoint, {
    data: {
      client_name: CLIENT_NAME,
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect(registered.ok()).toBe(true);
  const { client_id: clientId } = registrationSchema.parse(await registered.json());
  const flow: Flow = { metadata, resource: resource.resource, clientId };

  const { verifier, challenge } = pkce();
  await expectStartRefused(agent, flow, {});
  await expectStartRefused(agent, flow, {
    code_challenge: challenge,
    code_challenge_method: 'plain',
  });
  await expectStartRefused(agent, flow, { code_challenge_method: 'S256' });

  const page = await context.newPage();
  const captured: Captured = { url: null };
  await page.route(`${CALLBACK}**`, async (route) => {
    captured.url = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Connected' });
  });
  await page.goto(authorizeUrl(flow, challenge));
  await expect(page).toHaveURL(/\/login\?/);
  await signInSession(context, fixture.ownerEmail);
  const wrong = pkce();
  const rejectedCode = await consentAndCapture(
    page,
    captured,
    authorizeUrl(flow, wrong.challenge),
    fixture.workspaceName,
  );
  await expectRefused(
    await exchange(agent, flow, rejectedCode, pkce().verifier),
    401,
    'invalid_request',
  );
  await expectRefused(
    await exchange(agent, flow, rejectedCode, wrong.verifier),
    400,
    'invalid_grant',
  );

  const code = await consentAndCapture(
    page,
    captured,
    authorizeUrl(flow, challenge),
    fixture.workspaceName,
  );

  const exchanged = await exchange(agent, flow, code, verifier);
  expect(exchanged.ok()).toBe(true);
  const { access_token: accessToken, scope } = tokenSchema.parse(await exchanged.json());
  const granted = scope.split(/[\s,]+/);
  expect(granted).toEqual(expect.arrayContaining(['gravity.read', 'gravity.write']));
  expect(granted).not.toContain('gravity.approve');
  await expectRefused(await exchange(agent, flow, code, verifier), 400, 'invalid_grant');

  const initialized = await rpc(agent, accessToken, 1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'gravity-e2e', version: '0.0.0' },
  });
  expect(serverInfoSchema.parse(initialized.result?.['serverInfo']).name).toBe('gravity');
  const listed = await rpc(agent, accessToken, 2, 'tools/list', {});
  const names = toolListSchema.parse(listed.result).tools.map((tool) => tool.name);
  expect(names).toEqual(
    expect.arrayContaining(['describe_workspace', 'search', 'get_context', 'list_leads']),
  );
  const searched = await rpc(agent, accessToken, 3, 'tools/call', {
    name: 'search',
    arguments: { query: fixture.personName },
  });
  const { people } = searchResultSchema.parse(searched.result?.['structuredContent']);
  expect(people[0]?.name).toBe(fixture.personName);
  expect(people[0]?.url).toContain('/people/');

  await page.goto(`${BASE}/settings/mcp`);
  const connection = page.getByRole('listitem', { name: CLIENT_NAME });
  await expect(connection).toHaveCount(1);
  await page.getByRole('button', { name: `Revoke ${CLIENT_NAME}` }).click();
  const revoked = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname.startsWith('/api/mcp-grants/'),
  );
  await page.getByRole('button', { name: 'Revoke access' }).click();
  expect((await revoked).ok()).toBe(true);
  await expect(connection).toHaveCount(0);
  const refused = await agent.post(`${BASE}/mcp`, {
    headers: { ...MCP_HEADERS, authorization: `Bearer ${accessToken}` },
    data: { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
  });
  expect(refused.status()).toBe(401);
  expect(refused.headers()['www-authenticate']).toContain('invalid_token');
}
