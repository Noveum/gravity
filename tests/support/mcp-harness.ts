import {
  type StandardSchemaV1Sync,
  specTypeSchemas,
} from "@modelcontextprotocol/server";
import type { Principal } from "../../packages/core/policy";
import type { Database } from "../../packages/database/client";
import { mcpHandler } from "../../packages/mcp/server";

export function parseSpec<Input, Output>(
  schema: StandardSchemaV1Sync<Input, Output>,
  value: unknown,
): Output {
  const parsed = schema["~standard"].validate(value);
  if (parsed.issues !== undefined)
    throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

export function createMcpHarness(
  getDatabase: () => Database,
  organizationId: string,
  defaultPrincipal: Principal,
) {
  async function rpc(
    method: string,
    params: Record<string, unknown>,
    principal = defaultPrincipal,
  ) {
    const response = await mcpHandler(
      getDatabase(),
      principal,
      organizationId,
    ).fetch(
      new Request("http://127.0.0.1:3014/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    if (response.status !== 200)
      throw new Error(`Unexpected MCP status: ${response.status}`);
    const body = await response.text();
    const payload: unknown = JSON.parse(
      body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6) ?? body,
    );
    return parseSpec(specTypeSchemas.JSONRPCResponse, payload);
  }

  async function rpcResult<Input, Output>(
    schema: StandardSchemaV1Sync<Input, Output>,
    method: string,
    params: Record<string, unknown>,
    principal = defaultPrincipal,
  ): Promise<Output> {
    const envelope = await rpc(method, params, principal);
    if ("error" in envelope) throw new Error(envelope.error.message);
    return parseSpec(schema, envelope.result);
  }

  return { rpc, rpcResult };
}
