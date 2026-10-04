import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
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
