import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appDirectory, '..', '..');

const workspacePackages = ['@gravity/shared', '@gravity/db', '@gravity/core', '@gravity/services'];

const devServerOnlyBundledPackages = ['@react-email/render', '@react-email/components', 'prettier'];

function standaloneOutputUnlessVercelTracesItItself(): Pick<NextConfig, 'output'> {
  return process.env['VERCEL'] === '1' ? {} : { output: 'standalone' };
}

export default function config(phase: string): NextConfig {
  const isDevServer = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    agentRules: false,
    reactCompiler: true,
    ...standaloneOutputUnlessVercelTracesItItself(),
    outputFileTracingRoot: workspaceRoot,
    turbopack: {
      root: workspaceRoot,
    },
    transpilePackages: isDevServer
      ? [...workspacePackages, ...devServerOnlyBundledPackages]
      : workspacePackages,
    typedRoutes: false,
    experimental: {
      ...(process.env['GRAVITY_PREVIEW_BUILD'] === '1' ? { cpus: 1 } : {}),
      turbopackFileSystemCacheForDev: process.env['GRAVITY_TURBOPACK_DISK_CACHE'] !== 'false',
      optimizePackageImports: ['lucide-react'],
    },
  };
}
