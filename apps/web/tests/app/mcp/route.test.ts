import { afterAll, describe, expect, test } from 'bun:test';
import { closeRealtime } from '@gravity/core';
import { createWorkspace, mintMcpToken, resetDatabase } from '@gravity/core/test-support';
import { connect, rpcRequest } from '@gravity/mcp-server/test-helpers';
import { POST } from '@/app/mcp/route.ts';
import { withNativeFetch } from '../../support/native-fetch.ts';

const CANONICAL = 'https://crm.example.com';
const PREVIEW = 'https://gravity-git-feature.vercel.app';

afterAll(async () => {
  await closeRealtime();
});

async function onCanonicalOrigin<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env['BETTER_AUTH_URL'];
  process.env['BETTER_AUTH_URL'] = CANONICAL;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env['BETTER_AUTH_URL'];
    else process.env['BETTER_AUTH_URL'] = previous;
  }
}

describe('/mcp', () => {
  test('answers an anonymous call with 401 and the resource metadata of this origin', async () => {
    const response = await withNativeFetch(() =>
      POST(rpcRequest('tools/list', { origin: 'http://localhost:3300' })),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://localhost:3300/.well-known/oauth-protected-resource/mcp"',
    );
  });

  test('advertises the canonical origin even when called on another host', async () => {
    const response = await withNativeFetch(() =>
      onCanonicalOrigin(() => POST(rpcRequest('tools/list', { origin: PREVIEW }))),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${CANONICAL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  test('serves the scope-gated tools to a connected client', async () => {
    await resetDatabase();
    const workspace = await createWorkspace('Nimbus');
    const minted = await mintMcpToken(workspace.organizationId, workspace.adminUser.id);
    await withNativeFetch(async () => {
      const client = await connect(minted.token, { handle: POST });
      try {
        const { tools } = await client.client.listTools();
        expect(tools.map((tool) => tool.name)).toContain('describe_workspace');
        const { data } = await client.result('describe_workspace');
        expect(data['workspace']).toMatchObject({ name: 'Nimbus' });
      } finally {
        await client.close();
      }
    });
  });
});
