import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, db, eq, schema } from '@gravity/db';
import {
  bindMcpCredential,
  finalizeMcpConsent,
  listMcpGrants,
  passkeyVerifiedWithin,
  pendingMcpConsent,
  recordMcpGrant,
  revokeMcpGrant,
  unbindMcpCredential,
  userHasPasskey,
  verifyMcpAccessToken,
} from '../../src/auth/mcp-token.ts';
import { newId } from '../../src/internal.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  addMember,
  createWorkspace,
  insertMcpClient,
  insertMcpConsentRequest,
  mcpTestSecret,
  mintMcpToken,
  resetDatabase,
  type TestWorkspace,
} from '../../src/test-support.ts';

const CALLBACK = 'http://127.0.0.1:9000/callback';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await closeRealtime();
});

function registeredClient(): Promise<string> {
  return insertMcpClient(workspace.adminUser.id, { name: 'Desk agent', redirectUrl: CALLBACK });
}

function consentRequest(
  clientId: string,
  scope: readonly string[],
  userId = workspace.adminUser.id,
  expiresAt = new Date(Date.now() + 600_000),
): Promise<string> {
  return insertMcpConsentRequest({
    clientId,
    userId,
    scope,
    redirectUri: CALLBACK,
    state: 'state-1',
    expiresAt,
  });
}

describe('bound credentials', () => {
  test('round trip and refuse a tampered signature', () => {
    const bound = bindMcpCredential('at_raw', 'grant-1', 'secret-0123456789');
    expect(unbindMcpCredential(bound, 'secret-0123456789')).toEqual({
      credential: 'at_raw',
      grantId: 'grant-1',
    });
    expect(unbindMcpCredential(`${bound}x`, 'secret-0123456789')).toBeNull();
    expect(unbindMcpCredential(bound, 'another-secret-012')).toBeNull();
  });

  test('refuse a swapped grant, an extra segment and an empty secret', () => {
    const bound = bindMcpCredential('at_raw', 'grant-1', 'secret-0123456789');
    const [prefix, , token, signature] = bound.split('.');
    const swapped = [prefix, Buffer.from('grant-2').toString('base64url'), token, signature];
    expect(unbindMcpCredential(swapped.join('.'), 'secret-0123456789')).toBeNull();
    expect(unbindMcpCredential(`${bound}.extra`, 'secret-0123456789')).toBeNull();
    expect(unbindMcpCredential(bound, '')).toBeNull();
  });
});

describe('verifyMcpAccessToken', () => {
  test('resolves the principal of the grant workspace', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const identity = await verifyMcpAccessToken(minted.token);
    expect(identity.principal).toEqual(workspace.admin);
    expect(identity.organizationId).toBe(workspace.organizationId);
    expect(identity.clientId).toBe(minted.clientId);
    expect(identity.scopes).toBe('openid gravity.read gravity.write');
    const [grant] = await db
      .select()
      .from(schema.mcpGrant)
      .where(eq(schema.mcpGrant.id, minted.grantId));
    expect(grant?.lastUsedAt).toBeInstanceOf(Date);
  });

  test('refuses the raw token that was never bound to a grant', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    await expect(verifyMcpAccessToken(minted.rawAccessToken)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(verifyMcpAccessToken('   ')).rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('refuses a token bound with another secret', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const forged = bindMcpCredential(minted.rawAccessToken, minted.grantId, 'forged-secret-0123');
    await expect(verifyMcpAccessToken(forged)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('refuses a token bound to the grant of another client', async () => {
    const mine = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const other = await createWorkspace('Other');
    const theirs = await mintMcpToken(other.organizationId, other.adminUser.id);
    const crossed = bindMcpCredential(mine.rawAccessToken, theirs.grantId, mcpTestSecret());
    await expect(verifyMcpAccessToken(crossed)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('refuses an expired token', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    await db
      .update(schema.oauthAccessToken)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.oauthAccessToken.accessToken, minted.rawAccessToken));
    await expect(verifyMcpAccessToken(minted.token)).rejects.toThrow(
      'That access token has expired.',
    );
  });

  test('refuses a token whose grant was revoked', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    await db
      .update(schema.mcpGrant)
      .set({ revokedAt: new Date() })
      .where(eq(schema.mcpGrant.id, minted.grantId));
    await expect(verifyMcpAccessToken(minted.token)).rejects.toThrow(
      'This connection has been revoked. Reconnect Gravity to continue.',
    );
  });

  test('refuses a token from before the grant was given again', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const regranted = await recordMcpGrant({
      clientId: minted.clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: 'openid gravity.read',
    });
    expect(regranted).not.toBe(minted.grantId);
    await expect(verifyMcpAccessToken(minted.token)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  test('refuses a token that carries more scopes than its grant', async () => {
    const minted = await mintMcpToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'openid gravity.read',
    );
    await db
      .update(schema.oauthAccessToken)
      .set({ scopes: 'openid gravity.read gravity.approve' })
      .where(eq(schema.oauthAccessToken.accessToken, minted.rawAccessToken));
    await expect(verifyMcpAccessToken(minted.token)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  test('refuses a token whose client was disabled', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    await db
      .update(schema.oauthApplication)
      .set({ disabled: true })
      .where(eq(schema.oauthApplication.clientId, minted.clientId));
    await expect(verifyMcpAccessToken(minted.token)).rejects.toThrow(
      'This client has been disabled. Reconnect Gravity to continue.',
    );
  });

  test('refuses a member who has left the workspace', async () => {
    const guest = await addMember(workspace, 'Gus Guest', 'guest');
    const minted = await mintMcpToken(workspace.organizationId, guest.userId);
    await db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspace.organizationId),
          eq(schema.member.userId, guest.userId),
        ),
      );
    await expect(verifyMcpAccessToken(minted.token)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('consent', () => {
  test('shows the pending request from the database', async () => {
    const clientId = await registeredClient();
    const code = await consentRequest(clientId, ['openid', 'gravity.read']);
    expect(await pendingMcpConsent(workspace.adminUser.id, code)).toEqual({
      clientId,
      clientName: 'Desk agent',
      scopes: ['openid', 'gravity.read'],
    });
  });

  test('approval binds the client and user to the chosen workspace without approval rights', async () => {
    mcpTestSecret();
    const clientId = await registeredClient();
    const code = await consentRequest(clientId, ['openid', 'gravity.read', 'gravity.approve']);
    const approved = await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode: code,
      accept: true,
      organizationId: workspace.organizationId,
      allowApproval: false,
    });
    expect(approved.scope).toBe('openid gravity.read');
    const redirect = new URL(approved.redirectUri);
    expect(redirect.searchParams.get('state')).toBe('state-1');
    const authorizationCode = redirect.searchParams.get('code') ?? '';
    expect(authorizationCode.length).toBeGreaterThan(20);
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant).toMatchObject({
      clientId,
      organizationId: workspace.organizationId,
      scopes: 'openid gravity.read',
    });
    const [stored] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, authorizationCode));
    expect(JSON.parse(stored?.value ?? '{}')).toMatchObject({
      scope: ['openid', 'gravity.read'],
      requireConsent: false,
      mcpGrantId: grant?.id,
      codeChallengeMethod: 'S256',
    });
    const [consent] = await db.select().from(schema.oauthConsent);
    expect(consent).toMatchObject({ clientId, scopes: 'openid gravity.read', consentGiven: true });
  });

  test('approval rights need the explicit opt in', async () => {
    const clientId = await registeredClient();
    const code = await consentRequest(clientId, ['openid', 'gravity.read', 'gravity.approve']);
    await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode: code,
      accept: true,
      organizationId: workspace.organizationId,
      allowApproval: true,
    });
    const [grant] = await db.select().from(schema.mcpGrant);
    expect(grant?.scopes).toBe('openid gravity.read gravity.approve');
  });

  test('a request without read or write cannot be approved', async () => {
    const clientId = await registeredClient();
    const code = await consentRequest(clientId, ['openid', 'gravity.approve']);
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode: code,
        accept: true,
        organizationId: workspace.organizationId,
        allowApproval: true,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
  });

  test('a workspace the user does not belong to cannot be chosen', async () => {
    const clientId = await registeredClient();
    const other = await createWorkspace('Other');
    const code = await consentRequest(clientId, ['openid', 'gravity.read']);
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode: code,
        accept: true,
        organizationId: other.organizationId,
        allowApproval: false,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
    expect(await pendingMcpConsent(workspace.adminUser.id, code)).toMatchObject({ clientId });
  });

  test('approving again replaces the earlier grant and its tokens', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const code = await consentRequest(minted.clientId, ['openid', 'gravity.read']);
    await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode: code,
      accept: true,
      organizationId: workspace.organizationId,
      allowApproval: false,
    });
    const grants = await db.select().from(schema.mcpGrant);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.id).not.toBe(minted.grantId);
    expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
    await expect(verifyMcpAccessToken(minted.token)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  test('denial returns access_denied and consumes the request', async () => {
    const clientId = await registeredClient();
    const code = await consentRequest(clientId, ['openid', 'gravity.read']);
    const denied = await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode: code,
      accept: false,
    });
    const redirect = new URL(denied.redirectUri);
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('state')).toBe('state-1');
    expect(await db.select().from(schema.verification)).toHaveLength(0);
    expect(await db.select().from(schema.mcpGrant)).toHaveLength(0);
  });

  test('another user, an expired request and a second approval are refused', async () => {
    const clientId = await registeredClient();
    const other = await addMember(workspace, 'Olga Other', 'member');
    const theirs = await consentRequest(clientId, ['openid', 'gravity.read'], other.userId);
    await expect(pendingMcpConsent(workspace.adminUser.id, theirs)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      finalizeMcpConsent({ userId: workspace.adminUser.id, consentCode: theirs, accept: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const stale = await consentRequest(
      clientId,
      ['openid', 'gravity.read'],
      workspace.adminUser.id,
      new Date(Date.now() - 1000),
    );
    await expect(pendingMcpConsent(workspace.adminUser.id, stale)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    const once = await consentRequest(clientId, ['openid', 'gravity.read']);
    const input = {
      userId: workspace.adminUser.id,
      consentCode: once,
      accept: true as const,
      organizationId: workspace.organizationId,
      allowApproval: false,
    };
    await finalizeMcpConsent(input);
    await expect(finalizeMcpConsent(input)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('an issued authorization code cannot be approved as a consent request', async () => {
    const clientId = await registeredClient();
    const code = await consentRequest(clientId, ['openid', 'gravity.read']);
    const approved = await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode: code,
      accept: true,
      organizationId: workspace.organizationId,
      allowApproval: false,
    });
    const issued = new URL(approved.redirectUri).searchParams.get('code') ?? '';
    await expect(pendingMcpConsent(workspace.adminUser.id, issued)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  test('a request for a client that no longer exists is refused', async () => {
    const code = await consentRequest('client_gone', ['openid', 'gravity.read']);
    await expect(pendingMcpConsent(workspace.adminUser.id, code)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode: code,
        accept: true,
        organizationId: workspace.organizationId,
        allowApproval: false,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('a malformed request is refused rather than crashing', async () => {
    const code = newId().replace(/-/g, '');
    await db.insert(schema.verification).values({
      id: newId(),
      identifier: code,
      value: 'not json',
      expiresAt: new Date(Date.now() + 600_000),
    });
    await expect(pendingMcpConsent(workspace.adminUser.id, code)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    const clientId = await registeredClient();
    const badRedirect = await insertMcpConsentRequest({
      clientId,
      userId: workspace.adminUser.id,
      scope: ['openid', 'gravity.read'],
      redirectUri: 'not a url',
    });
    await expect(
      finalizeMcpConsent({
        userId: workspace.adminUser.id,
        consentCode: badRedirect,
        accept: false,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('passkeys', () => {
  test('report whether the user has one and when it was last used', async () => {
    const userId = workspace.adminUser.id;
    expect(await userHasPasskey(userId)).toBe(false);
    const now = new Date();
    await db.insert(schema.passkey).values({
      id: newId(),
      publicKey: 'public-key',
      userId,
      credentialID: 'credential-1',
      deviceType: 'singleDevice',
      lastUsedAt: new Date(now.getTime() - 120_000),
    });
    expect(await userHasPasskey(userId)).toBe(true);
    expect(await passkeyVerifiedWithin(userId, 300_000, now)).toBe(true);
    expect(await passkeyVerifiedWithin(userId, 60_000, now)).toBe(false);
  });
});

describe('grants', () => {
  test('list the connections of a user and revoke one with its tokens', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const [listed] = await listMcpGrants(workspace.adminUser.id);
    expect(listed).toMatchObject({
      id: minted.grantId,
      clientName: 'Test agent',
      organizationId: workspace.organizationId,
      organizationName: 'Acme',
    });
    await revokeMcpGrant(minted.grantId, workspace.adminUser.id);
    expect(await listMcpGrants(workspace.adminUser.id)).toHaveLength(0);
    expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
    await expect(verifyMcpAccessToken(minted.token)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(revokeMcpGrant(minted.grantId, workspace.adminUser.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  test('a user cannot revoke another user connection', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const other = await addMember(workspace, 'Olga Other', 'member');
    await expect(revokeMcpGrant(minted.grantId, other.userId)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await listMcpGrants(workspace.adminUser.id)).toHaveLength(1);
    expect((await verifyMcpAccessToken(minted.token)).userId).toBe(workspace.adminUser.id);
  });
});
