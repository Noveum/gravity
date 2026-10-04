import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { notFound } from '@gravity/shared/errors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../src/logger.ts';
import {
  allowTools,
  answerWithoutTools,
  defineTool,
  type ToolAccess,
} from '../../src/tools/support.ts';

const open: { client: Client; server: McpServer }[] = [];

afterEach(async () => {
  for (const { client, server } of open.splice(0)) {
    await client.close();
    await server.close();
  }
});

async function serve(access: ToolAccess, failure?: unknown): Promise<Client> {
  const server = new McpServer({ name: 'support-test', version: '0.0.0' });
  allowTools(server, access);
  defineTool(
    server,
    { name: 'peek', title: 'Peek', description: 'Reads.', scope: 'read', inputSchema: {} },
    () =>
      failure === undefined
        ? Promise.resolve({ text: 'peeked', data: {} })
        : Promise.reject(failure),
  );
  defineTool(
    server,
    { name: 'poke', title: 'Poke', description: 'Writes.', scope: 'write', inputSchema: {} },
    () => Promise.resolve({ text: 'poked', data: {} }),
  );
  answerWithoutTools(server);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'support-test-client', version: '0.0.0' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  open.push({ client, server });
  return client;
}

async function outcome(client: Client, name: string): Promise<string> {
  try {
    const result = (await client.callTool({ name, arguments: {} })) as CallToolResult;
    return result.isError === true ? 'refused' : 'answered';
  } catch {
    return 'refused';
  }
}

describe('scope gate', () => {
  test('a write tool is absent from a read-only server and refused when called', async () => {
    const client = await serve({ reads: true, writes: false });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['peek']);
    expect(await outcome(client, 'poke')).toBe('refused');
    expect(await outcome(client, 'peek')).toBe('answered');
  });

  test('the same write tool is listed and answers when writes are granted', async () => {
    const client = await serve({ reads: true, writes: true });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['peek', 'poke']);
    const poke = tools.find((tool) => tool.name === 'poke');
    expect(poke?.annotations?.readOnlyHint).toBe(false);
    expect(await outcome(client, 'poke')).toBe('answered');
  });
});

describe('tool failures', () => {
  test('an unexpected exception is logged at error and hidden from the caller', async () => {
    const error = spyOn(logger, 'error');
    const warn = spyOn(logger, 'warn');
    try {
      const client = await serve({ reads: true, writes: false }, new Error('database exploded'));
      const result = (await client.callTool({ name: 'peek', arguments: {} })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).not.toContain('database exploded');
      expect(error).toHaveBeenCalledWith('tool failed', expect.objectContaining({ tool: 'peek' }));
      expect(warn).not.toHaveBeenCalledWith('tool failed', expect.anything());
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  test('an expected refusal is logged at warn and named to the caller', async () => {
    const error = spyOn(logger, 'error');
    const warn = spyOn(logger, 'warn');
    try {
      const client = await serve({ reads: true, writes: false }, notFound('No such lead.'));
      const result = (await client.callTool({ name: 'peek', arguments: {} })) as CallToolResult;
      expect(JSON.stringify(result.content)).toContain('No such lead.');
      expect(warn).toHaveBeenCalledWith('tool failed', expect.objectContaining({ tool: 'peek' }));
      expect(error).not.toHaveBeenCalledWith('tool failed', expect.anything());
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });
});
