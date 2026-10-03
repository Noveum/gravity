import { describe, expect, test } from 'bun:test';
import { memberUpdateSchema } from '../../src/validators/organization.ts';

describe('memberUpdateSchema', () => {
  test('accepts a role alone', () => {
    expect(memberUpdateSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' });
  });

  test('accepts isAgent alone', () => {
    expect(memberUpdateSchema.parse({ isAgent: true })).toEqual({ isAgent: true });
  });

  test('rejects an empty object', () => {
    expect(memberUpdateSchema.safeParse({}).success).toBe(false);
  });
});
