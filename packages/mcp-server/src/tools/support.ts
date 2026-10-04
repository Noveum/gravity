import { type DomainError, toDomainError, validationFailed } from '@gravity/shared/errors';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { errorFields, logger } from '../logger.ts';

export interface ToolResult {
  readonly text: string;
  readonly data: Record<string, unknown>;
}

export type ToolScope = 'read' | 'write';

export interface ToolConfig<Shape extends z.ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly scope: ToolScope;
  readonly inputSchema: Shape;
}

export interface ToolAccess {
  readonly reads: boolean;
  readonly writes: boolean;
}

const GRANTED = new WeakMap<McpServer, ToolAccess>();
const SERVING_TOOLS = new WeakSet<McpServer>();

export function allowTools(server: McpServer, access: ToolAccess): void {
  GRANTED.set(server, access);
}

function mayRegister(server: McpServer, scope: ToolScope): boolean {
  const access = GRANTED.get(server);
  if (access === undefined) return false;
  return scope === 'read' ? access.reads : access.writes;
}

export function answerWithoutTools(server: McpServer): void {
  if (SERVING_TOOLS.has(server)) return;
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  server.server.setRequestHandler(CallToolRequestSchema, (request) => {
    throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
  });
}

export function ok(result: ToolResult): CallToolResult {
  return { content: [{ type: 'text', text: result.text }], structuredContent: result.data };
}

function asDomainError(error: unknown): DomainError {
  if (error instanceof z.ZodError) {
    return validationFailed(
      error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; '),
    );
  }
  return toDomainError(error);
}

export function failed(name: string, error: unknown): CallToolResult {
  const domain = asDomainError(error);
  const fields = { tool: name, code: domain.code, ...errorFields(error) };
  if (domain.status >= 500) logger.error('tool failed', fields);
  else logger.warn('tool failed', fields);
  const body =
    domain.status >= 500
      ? { error: { code: domain.code, message: 'Something went wrong on our side.' } }
      : domain.toJSON();
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
}

export function defineTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  config: ToolConfig<Shape>,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>,
): void {
  if (!mayRegister(server, config.scope)) return;
  const inputSchema = z.strictObject(config.inputSchema) as unknown as z.ZodObject<Shape>;
  SERVING_TOOLS.add(server);
  server.registerTool<z.ZodRawShape, z.ZodObject<Shape>>(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema,
      annotations: {
        title: config.title,
        readOnlyHint: config.scope === 'read',
        destructiveHint: false,
        idempotentHint: config.scope === 'read',
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        return ok(await run(args as z.infer<z.ZodObject<Shape>>));
      } catch (error: unknown) {
        return failed(config.name, error);
      }
    },
  );
}
