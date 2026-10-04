import { describe, expect, test } from 'bun:test';
import { readFile, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseLock, resolutionsOf } from '../check-dependency-dedupe.ts';

const lock = parseLock(await readFile(new URL('../../bun.lock', import.meta.url), 'utf8'));

function versionsOf(name: string): string[] {
  return [...new Set(resolutionsOf(lock, name).map((entry) => entry.version))].sort();
}

describe('the auth stack', () => {
  test('better-auth and its siblings resolve once, at the release that ships the mcp plugin', () => {
    expect(versionsOf('better-auth')).toEqual(['1.6.26']);
    expect(versionsOf('@better-auth/core')).toEqual(['1.6.26']);
    expect(versionsOf('@better-auth/passkey')).toEqual(['1.6.26']);
  });

  test('no zod at 4.5 or later is installed, because it breaks MCP tools/list', () => {
    const tooNew = versionsOf('zod').filter((version) => Bun.semver.satisfies(version, '>=4.5.0'));
    expect(tooNew).toEqual([]);
  });
});

describe('the MCP SDK', () => {
  test('resolves once and shares the workspace zod', () => {
    expect(versionsOf('@modelcontextprotocol/sdk')).toEqual(['1.30.0']);
    const nested = resolutionsOf(lock, 'zod')
      .map((entry) => entry.holder)
      .filter((holder) => holder.startsWith('@modelcontextprotocol/sdk/'));
    expect(nested).toEqual([]);
  });

  test('loads the same installed zod as the MCP server package', async () => {
    const serverPackage = new URL('../../packages/mcp-server/', import.meta.url).pathname;
    const sdkManifest = Bun.resolveSync('@modelcontextprotocol/sdk/package.json', serverPackage);
    const zodOfSdk = await realpath(Bun.resolveSync('zod/package.json', dirname(sdkManifest)));
    const zodOfServer = await realpath(Bun.resolveSync('zod/package.json', serverPackage));
    expect(zodOfSdk).toBe(zodOfServer);
    const installed: unknown = JSON.parse(await readFile(zodOfServer, 'utf8'));
    expect(installed).toMatchObject({ version: '4.4.3' });
  });
});

describe('better-fetch', () => {
  test('resolves once, so better-call shares the copy better-auth pins', () => {
    expect(versionsOf('@better-fetch/fetch')).toEqual(['1.3.1']);
  });
});
