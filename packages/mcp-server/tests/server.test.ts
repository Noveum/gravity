import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { closeRealtime } from '@gravity/core';
import {
  addMember,
  createWorkspace,
  mintMcpToken,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { and, db, eq, schema } from '@gravity/db';
import { MCP_PATH } from '../src/server.ts';
import { callMcp, connect, MCP_TEST_ORIGIN, rpcRequest } from '../src/test-helpers.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nimbus');
});

afterAll(async () => {
  await closeRealtime();
});

const RESOURCE_CHALLENGE =
  'Bearer resource_metadata="http://localhost:3300/.well-known/oauth-protected-resource/mcp"';

function listTools(headers: Record<string, string>): Promise<Response> {
  return callMcp(rpcRequest('tools/list', { headers }));
}

describe('authentication', () => {
  test('a request without a token gets 401 and the protected resource metadata', async () => {
    const response = await listTools({});
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(RESOURCE_CHALLENGE);
    expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: null });
  });

  test('a token that is not ours gets 401 and the same challenge', async () => {
    const response = await listTools({ authorization: 'Bearer not-a-gravity-token' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(RESOURCE_CHALLENGE);
  });

  test('GET is refused with 405', async () => {
    const response = await callMcp(new Request(`${MCP_TEST_ORIGIN}${MCP_PATH}`));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  test('a token with neither read nor write is refused with 403 before any tool exists', async () => {
    const minted = await mintMcpToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'openid offline_access',
    );
    const response = await listTools({ authorization: `Bearer ${minted.token}` });
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer error="insufficient_scope", scope="gravity.read"',
    );
    expect(JSON.stringify(await response.json())).not.toContain('describe_workspace');
  });

  test('a revoked connection gets 401', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    await db
      .update(schema.mcpGrant)
      .set({ revokedAt: new Date() })
      .where(eq(schema.mcpGrant.id, minted.grantId));
    const response = await listTools({ authorization: `Bearer ${minted.token}` });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(RESOURCE_CHALLENGE);
  });

  test('a member removed from the workspace is refused without a scope challenge', async () => {
    const member = await addMember(workspace, 'Mia Member', 'member');
    const minted = await mintMcpToken(workspace.organizationId, member.userId);
    await db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspace.organizationId),
          eq(schema.member.userId, member.userId),
        ),
      );
    const response = await listTools({ authorization: `Bearer ${minted.token}` });
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });
});

describe('scope gating', () => {
  test('a read token lists read tools with read-only hints', async () => {
    const minted = await mintMcpToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'openid gravity.read',
    );
    const client = await connect(minted.token);
    try {
      const { tools } = await client.client.listTools();
      const describe = tools.find((tool) => tool.name === 'describe_workspace');
      expect(describe?.annotations?.readOnlyHint).toBe(true);
      expect(describe?.annotations?.destructiveHint).toBe(false);
      expect(describe?.inputSchema.type).toBe('object');
    } finally {
      await client.close();
    }
  });

  test('a write-only token sees no read tool and cannot call one', async () => {
    const minted = await mintMcpToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'openid gravity.write',
    );
    const client = await connect(minted.token);
    try {
      const { tools } = await client.client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain('describe_workspace');
      const outcome = await client.call('describe_workspace').then(
        (result) => (result.isError === true ? 'refused' : 'answered'),
        () => 'refused',
      );
      expect(outcome).toBe('refused');
    } finally {
      await client.close();
    }
  });

  test('a tool refuses arguments it does not declare, so no caller can name a workspace', async () => {
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    const client = await connect(minted.token);
    try {
      const called = await client.call('describe_workspace', { organizationId: 'elsewhere' });
      expect(called.isError).toBe(true);
      expect(called.structuredContent).toBeUndefined();
    } finally {
      await client.close();
    }
  });
});
