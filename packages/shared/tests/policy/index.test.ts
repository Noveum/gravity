import { describe, expect, test } from 'bun:test';
import { DomainError } from '../../src/errors/index.ts';
import { assertCan, can, canAssignRole, type Principal } from '../../src/policy/index.ts';

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
