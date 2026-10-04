import { describe, expect, test } from 'bun:test';
import { DomainError } from '../../src/errors/index.ts';
import {
  assertCan,
  can,
  canAssignRole,
  PERMISSION_ACTIONS,
  PERMISSIONS,
  type Principal,
  usableMcpScopes,
} from '../../src/policy/index.ts';

const as = (role: Principal['role']): Principal => ({ userId: 'u', organizationId: 'o', role });

describe('policy', () => {
  test('guests read records and nothing else', () => {
    expect(can(as('guest'), 'record:read')).toBe(true);
    expect(can(as('guest'), 'record:write')).toBe(false);
  });

  test('contributors write records but cannot manage pipelines', () => {
    expect(can(as('contributor'), 'record:write')).toBe(true);
    expect(can(as('contributor'), 'pipeline:manage')).toBe(false);
  });

  test('members manage pipelines and invite', () => {
    expect(can(as('member'), 'pipeline:manage')).toBe(true);
    expect(can(as('member'), 'member:invite')).toBe(true);
    expect(can(as('member'), 'workspace:manage')).toBe(false);
  });

  test('admins manage the workspace', () => {
    expect(can(as('admin'), 'workspace:delete')).toBe(true);
  });

  test('assertCan throws a forbidden domain error', () => {
    expect(() => assertCan(as('guest'), 'record:write')).toThrow(DomainError);
  });

  test('nobody assigns a role above their own', () => {
    expect(canAssignRole(as('member'), 'admin')).toBe(false);
    expect(canAssignRole(as('admin'), 'admin')).toBe(true);
  });
});

describe('usableMcpScopes', () => {
  const asked = ['openid', 'offline_access', 'gravity.read', 'gravity.write', 'gravity.approve'];

  test('a guest keeps read and drops write', () => {
    expect(usableMcpScopes('guest', asked)).toEqual([
      'openid',
      'offline_access',
      'gravity.read',
      'gravity.approve',
    ]);
  });

  test('a role that can write records keeps write', () => {
    for (const role of ['contributor', 'member', 'admin'] as const) {
      expect(usableMcpScopes(role, asked)).toEqual(asked);
    }
  });
});

describe('permission labels', () => {
  test('a refusal names the action in plain words', () => {
    const guest: Principal = { userId: 'u', organizationId: 'o', role: 'guest' };
    expect(() => assertCan(guest, 'import:run')).toThrow('Your role cannot run imports.');
    expect(() => assertCan(guest, 'record:write')).toThrow('Your role cannot edit records.');
    expect(() => assertCan(guest, 'pipeline:manage')).toThrow('Your role cannot manage pipelines.');
  });

  test('every permission has a label', () => {
    for (const permission of PERMISSIONS) {
      expect(PERMISSION_ACTIONS[permission].length).toBeGreaterThan(0);
    }
  });
});
