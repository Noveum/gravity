import { beforeEach, describe, expect, test } from 'bun:test';
import { recordMcpGrant, verifyMcpAccessToken } from '@gravity/core';
import {
  addMember,
  createWorkspace,
  insertMcpClient,
  mintMcpToken,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { DELETE } from '@/app/api/mcp-grants/[id]/route.ts';
import { GET } from '@/app/api/mcp-grants/route.ts';
import { signedInAs, signedOut } from '../../../../tests-support.ts';

interface Listed {
  readonly id: string;
  readonly clientName: string;
  readonly clientLogo: string | null;
  readonly redirectHosts: string[];
  readonly organizationName: string;
  readonly scopes: string[];
  readonly lastUsedAt: string | null;
}

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nimbus');
});

function remove(id: string): Promise<Response> {
  return DELETE(new Request(`http://localhost:3300/api/mcp-grants/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

async function listed(): Promise<Listed[]> {
  const body = (await (await GET()).json()) as { connections: Listed[] };
  return body.connections;
}

describe('/api/mcp-grants', () => {
  test('lists only the caller connections and revokes one with its tokens', async () => {
    const mine = await mintMcpToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'openid gravity.read',
    );
    const teammate = await addMember(workspace, 'Tess Teammate', 'member');
    await mintMcpToken(workspace.organizationId, teammate.userId);
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    expect(await listed()).toEqual([
      expect.objectContaining({
        id: mine.grantId,
        scopes: ['openid', 'gravity.read'],
        organizationName: 'Nimbus',
        redirectHosts: ['127.0.0.1:4321'],
        clientLogo: null,
        lastUsedAt: null,
      }),
    ]);
    expect((await remove(mine.grantId)).status).toBe(200);
    expect(await listed()).toEqual([]);
    expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(1);
  });

  test('a revoked connection token is refused at once', async () => {
    const mine = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    expect((await verifyMcpAccessToken(mine.token)).userId).toBe(workspace.adminUser.id);
    expect((await remove(mine.grantId)).status).toBe(200);
    await expect(verifyMcpAccessToken(mine.token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('the logo and redirect hosts are what the client registered, and an unsafe logo is dropped', async () => {
    const safe = await insertMcpClient(workspace.adminUser.id, {
      name: 'Logo agent',
      icon: 'https://agent.example.com/logo.png',
      redirectUrl: 'https://agent.example.com/cb',
    });
    const unsafe = await insertMcpClient(workspace.adminUser.id, {
      name: 'Script agent',
      icon: 'javascript:alert(1)',
    });
    for (const clientId of [safe, unsafe]) {
      await recordMcpGrant({
        clientId,
        userId: workspace.adminUser.id,
        organizationId: workspace.organizationId,
        scopes: 'openid gravity.read',
      });
    }
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const connections = await listed();
    expect(connections.find((entry) => entry.clientName === 'Logo agent')).toMatchObject({
      clientLogo: 'https://agent.example.com/logo.png',
      redirectHosts: ['agent.example.com'],
    });
    expect(connections.find((entry) => entry.clientName === 'Script agent')?.clientLogo).toBeNull();
  });

  test('a teammate cannot revoke my connection', async () => {
    const mine = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const teammate = await addMember(workspace, 'Tess Teammate', 'member');
    await signedInAs(teammate.userId, workspace.organizationId);
    expect((await remove(mine.grantId)).status).toBe(404);
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    expect(await listed()).toHaveLength(1);
    expect((await verifyMcpAccessToken(mine.token)).userId).toBe(workspace.adminUser.id);
  });

  test('revoking twice and revoking an id that is not an id both answer 404', async () => {
    const mine = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    expect((await remove(mine.grantId)).status).toBe(200);
    expect((await remove(mine.grantId)).status).toBe(404);
    expect((await remove('not-an-id')).status).toBe(404);
  });

  test('a signed out caller gets 401 on both', async () => {
    const mine = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    signedOut();
    expect((await GET()).status).toBe(401);
    expect((await remove(mine.grantId)).status).toBe(401);
  });
});
