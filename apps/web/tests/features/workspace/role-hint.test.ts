import { describe, expect, test } from 'bun:test';
import { minimumRoleFor } from '@/features/workspace/role-hint.ts';

describe('minimumRoleFor', () => {
  test('names the least role that holds a permission', () => {
    expect(minimumRoleFor('record:read')).toBe('guest');
    expect(minimumRoleFor('record:write')).toBe('contributor');
    expect(minimumRoleFor('pipeline:manage')).toBe('member');
    expect(minimumRoleFor('member:manage')).toBe('admin');
  });
});
