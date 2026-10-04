import { describe, expect, test } from 'bun:test';
import { refuseUnsafeAuthorize } from '@/lib/auth/mcp-oauth.ts';
import { mcpServerUrl } from '@/lib/env.ts';

describe('refuseUnsafeAuthorize', () => {
  function authorize(search: Record<string, string>): Request {
    return new Request(
      `http://localhost:3300/api/auth/mcp/authorize?${new URLSearchParams(search).toString()}`,
    );
  }

  test('ignores every other auth path', () => {
    expect(refuseUnsafeAuthorize(new Request('http://localhost:3300/api/auth/session'))).toBeNull();
  });

  test('refuses a resource that is not this MCP server', async () => {
    const refused = refuseUnsafeAuthorize(
      authorize({ prompt: 'consent', resource: 'https://other.example.com/mcp' }),
    );
    expect(refused?.status).toBe(400);
    expect(await refused?.json()).toMatchObject({ error: 'invalid_target' });
    expect(
      refuseUnsafeAuthorize(authorize({ prompt: 'consent', resource: mcpServerUrl() })),
    ).toBeNull();
  });
});
