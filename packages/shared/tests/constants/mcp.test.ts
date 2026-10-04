import { describe, expect, test } from 'bun:test';
import {
  consentedScopes,
  GRAVITY_APPROVE_SCOPE,
  grantsApproval,
  grantsReads,
  grantsWrites,
  MCP_OAUTH_SCOPES,
  MCP_SCOPE_LABELS,
  scopeList,
} from '../../src/constants/mcp.ts';

describe('gravity scopes', () => {
  test('parse space or comma separated scopes once each', () => {
    expect(scopeList('openid gravity.read,gravity.read  gravity.write')).toEqual([
      'openid',
      'gravity.read',
      'gravity.write',
    ]);
    expect(scopeList('  ')).toEqual([]);
  });

  test('read, write and approval are separate grants', () => {
    expect(grantsReads('openid gravity.read')).toBe(true);
    expect(grantsWrites('openid gravity.read')).toBe(false);
    expect(grantsWrites('gravity.write')).toBe(true);
    expect(grantsApproval('gravity.approve')).toBe(true);
    expect(grantsApproval('openid gravity.read gravity.write')).toBe(false);
    expect(grantsReads('gravity.readonly')).toBe(false);
  });

  test('consent drops approval unless the user allowed it', () => {
    const requested = ['openid', 'gravity.read', GRAVITY_APPROVE_SCOPE];
    expect(consentedScopes(requested, false)).toEqual(['openid', 'gravity.read']);
    expect(consentedScopes(requested, true)).toEqual(requested);
  });

  test('allowing approval never adds a scope the client did not ask for', () => {
    expect(consentedScopes(['openid', 'gravity.read', 'gravity.read'], true)).toEqual([
      'openid',
      'gravity.read',
    ]);
  });

  test('the OAuth server advertises every gravity scope', () => {
    expect(MCP_OAUTH_SCOPES).toContain('gravity.read');
    expect(MCP_OAUTH_SCOPES).toContain('gravity.write');
    expect(MCP_OAUTH_SCOPES).toContain('gravity.approve');
    expect(MCP_OAUTH_SCOPES).toContain('offline_access');
  });

  test('every gravity scope has a consent label', () => {
    for (const scope of ['gravity.read', 'gravity.write', 'gravity.approve']) {
      expect(MCP_SCOPE_LABELS[scope]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
