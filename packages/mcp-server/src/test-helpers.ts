import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { handleMcpRequest, MCP_PATH } from './server.ts';

export const MCP_TEST_PUBLIC_URL = 'http://localhost:3300';
export const MCP_TEST_ORIGIN = 'http://mcp.test';

export type McpHandler = (request: Request) => Promise<Response>;

export function callMcp(request: Request): Promise<Response> {
  return handleMcpRequest(request, { publicUrl: MCP_TEST_PUBLIC_URL });
}

export interface RpcRequestOptions {
  readonly params?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
  readonly origin?: string;
}

export function rpcRequest(method: string, options: RpcRequestOptions = {}): Request {
  return new Request(`${options.origin ?? MCP_TEST_ORIGIN}${MCP_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...options.headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: options.params ?? {} }),
  });
}

const errorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export interface TestClient {
  readonly client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  result(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ text: string; data: Record<string, unknown> }>;
  failure(name: string, args?: Record<string, unknown>): Promise<{ code: string; message: string }>;
  close(): Promise<void>;
}

export interface ConnectOptions {
  readonly handle?: McpHandler;
}

function textOf(result: CallToolResult): string {
  const [first] = result.content;
  if (first === undefined || first.type !== 'text') throw new Error('The tool returned no text.');
  return first.text;
}

export async function connect(
  accessToken: string,
  options: ConnectOptions = {},
): Promise<TestClient> {
  const handle = options.handle ?? callMcp;
  const client = new Client({ name: 'gravity-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_TEST_ORIGIN}${MCP_PATH}`), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    fetch: (url, init) => handle(new Request(typeof url === 'string' ? url : url.toString(), init)),
  });
  await client.connect(transport as unknown as Transport);
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  return {
    client,
    call,
    async result(name, args = {}) {
      const called = await call(name, args);
      if (called.isError === true) throw new Error(`tool ${name} failed: ${textOf(called)}`);
      return { text: textOf(called), data: called.structuredContent ?? {} };
    },
    async failure(name, args = {}) {
      const called = await call(name, args);
      if (called.isError !== true) throw new Error(`tool ${name} unexpectedly succeeded`);
      return errorBodySchema.parse(JSON.parse(textOf(called))).error;
    },
    close: () => client.close(),
  };
}
