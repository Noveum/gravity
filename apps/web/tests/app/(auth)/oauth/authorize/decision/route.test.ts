import { beforeEach, describe, expect, test } from 'bun:test';
import { createOrganization, newId } from '@gravity/core';
import {
  addMember,
  createWorkspace,
  insertMcpClient,
  insertMcpConsentRequest,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { db, eq, schema } from '@gravity/db';
import { POST } from '@/app/(auth)/oauth/authorize/decision/route.ts';
import { signedInAs, signedOut } from '../../../../../../tests-support.ts';
import { withNativeFetch } from '../../../../../support/native-fetch.ts';

const ORIGIN = 'http://localhost:3300';
const CALLBACK = 'http://127.0.0.1:9000/callback';

let workspace: TestWorkspace;
let clientId: string;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Consent');
  clientId = await insertMcpClient(workspace.adminUser.id, {
    name: 'Desk agent',
    redirectUrl: CALLBACK,
  });
  await signedInAs(workspace.adminUser.id, workspace.organizationId);
});

function consentCode(
  scope: readonly string[] = ['openid', 'gravity.read', 'gravity.approve'],
  userId = workspace.adminUser.id,
): Promise<string> {
  return insertMcpConsentRequest({ clientId, userId, scope, redirectUri: CALLBACK, state: 's1' });
}

function decide(body: Record<string, unknown>, origin = ORIGIN): Promise<Response> {
  return withNativeFetch(() =>
    POST(
      new Request(`${ORIGIN}/oauth/authorize/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      }),
    ),
  );
}

async function allowBody(code?: string): Promise<Record<string, unknown>> {
  return {
    decision: 'allow',
    consentCode: code ?? (await consentCode()),
    organizationId: workspace.organizationId,
    allowApproval: false,
  };
}

async function ageSession(): Promise<void> {
  await db
    .update(schema.session)
    .set({ createdAt: new Date(Date.now() - 3_600_000) })
    .where(eq(schema.session.userId, workspace.adminUser.id));
}

async function addPasskey(): Promise<void> {
  await db.insert(schema.passkey).values({
    id: newId(),
    publicKey: 'key',
    userId: workspace.adminUser.id,
    credentialID: 'credential-1',
    deviceType: 'singleDevice',
  });
}

describe('/oauth/authorize/decision', () => {
  test('approves into the chosen workspace and leaves approval rights off by default', async () => {
    const response = await decide(await allowBody());
    expect(response.status).toBe(200);
    const { redirectUri } = (await response.json()) as { redirectUri: string };
    const redirect = new URL(redirectUri);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK);
    expect(redirect.searchParams.get('code')).not.toBeNull();
    expect(redirect.searchParams.get('state')).toBe('s1');
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant?.scopes).toBe('openid gravity.read');
    expect(grant?.organizationId).toBe(workspace.organizationId);
  });

  test('grants approval rights only when the box was ticked', async () => {
    await decide({ ...(await allowBody()), allowApproval: true });
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant?.scopes).toBe('openid gravity.read gravity.approve');
  });

  test('denial redirects with access_denied and writes no grant', async () => {
    const response = await decide({ ...(await allowBody()), decision: 'deny' });
    const { redirectUri } = (await response.json()) as { redirectUri: string };
    expect(new URL(redirectUri).searchParams.get('error')).toBe('access_denied');
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
  });

  test('refuses another origin, no session, a foreign workspace and another user code', async () => {
    const body = await allowBody();
    expect((await decide(body, 'https://evil.example.com')).status).toBe(403);
    const elsewhere = await createWorkspace('Elsewhere');
    const foreign = await decide({ ...body, organizationId: elsewhere.organizationId });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toMatchObject({ error: 'invalid_workspace' });
    const other = await addMember(workspace, 'Olga Other', 'member');
    const theirs = await decide({
      ...body,
      consentCode: await consentCode(undefined, other.userId),
    });
    expect(theirs.status).toBe(403);
    signedOut();
    expect((await decide(body)).status).toBe(401);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
  });

  test('refuses a malformed body with a message', async () => {
    const missing = await decide({ decision: 'allow', consentCode: 'x' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'invalid_request' });
    const unknown = await decide({ ...(await allowBody()), decision: 'maybe' });
    expect(unknown.status).toBe(400);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
  });

  test('a second approval of the same code is refused', async () => {
    const body = await allowBody();
    expect((await decide(body)).status).toBe(200);
    const again = await decide(body);
    expect(again.status).toBe(401);
    expect(await again.json()).toMatchObject({
      message: 'This authorization request is invalid or has expired.',
    });
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(1);
  });

  test('a passkey holder with an old session must verify again, then may approve', async () => {
    await addPasskey();
    await ageSession();
    const body = await allowBody();
    expect(await (await decide(body)).json()).toEqual({ status: 'passkey_required' });
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
    await db
      .update(schema.passkey)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.passkey.userId, workspace.adminUser.id));
    expect(await (await decide(body)).json()).toHaveProperty('redirectUri');
  });

  test('a passkey holder who signed in minutes ago approves without verifying again', async () => {
    await addPasskey();
    expect(await (await decide(await allowBody())).json()).toHaveProperty('redirectUri');
  });

  test('a user without a passkey is not asked to verify again in this release', async () => {
    await ageSession();
    expect(await (await decide(await allowBody())).json()).toHaveProperty('redirectUri');
  });

  test('a passkey holder with an old session may still deny without verifying', async () => {
    await addPasskey();
    await ageSession();
    const response = await decide({ ...(await allowBody()), decision: 'deny' });
    expect(response.status).toBe(200);
    const { redirectUri } = (await response.json()) as { redirectUri: string };
    expect(new URL(redirectUri).searchParams.get('error')).toBe('access_denied');
  });

  test('a member of two workspaces may pick either', async () => {
    const second = await createOrganization(workspace.adminUser.id, {
      name: 'Second',
      slug: `second-${newId().slice(-8)}`,
    });
    await decide({ ...(await allowBody()), organizationId: second.organization.id });
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant?.organizationId).toBe(second.organization.id);
  });
});
