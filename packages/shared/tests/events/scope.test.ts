import { describe, expect, test } from 'bun:test';
import { parseScope, scopes } from '../../src/events/scope.ts';

describe('scopes', () => {
  test('builds one prefix per kind', () => {
    expect(scopes.workspace('o1')).toBe('workspace:o1');
    expect(scopes.brand('b1')).toBe('brand:b1');
    expect(scopes.pipeline('p1')).toBe('pipeline:p1');
    expect(scopes.person('x1')).toBe('person:x1');
    expect(scopes.company('c1')).toBe('company:c1');
    expect(scopes.user('u1')).toBe('user:u1');
  });

  test('parses what it builds', () => {
    expect(parseScope('pipeline:p1')).toEqual({ kind: 'pipeline', id: 'p1' });
  });

  test('rejects unknown kinds and empty ids', () => {
    expect(parseScope('team:t1')).toBeNull();
    expect(parseScope('brand:')).toBeNull();
    expect(parseScope('nonsense')).toBeNull();
  });
});
