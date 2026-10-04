import type { Principal } from '@gravity/shared/policy';
import type { RecordLinks } from '@gravity/shared/utils';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWorkspaceTools } from './workspace.ts';

export interface ToolContext {
  readonly principal: Principal;
  readonly links: RecordLinks;
}

export function registerTools(server: McpServer, context: ToolContext): void {
  registerWorkspaceTools(server, context);
}
