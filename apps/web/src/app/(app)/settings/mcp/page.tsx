import type { Metadata } from 'next';
import { McpPanel } from '@/features/settings/mcp-panel.tsx';
import { mcpServerUrl } from '@/lib/env.ts';

export const metadata: Metadata = { title: 'MCP clients' };
export const dynamic = 'force-dynamic';

export default function McpSettingsPage() {
  return <McpPanel serverUrl={mcpServerUrl()} />;
}
