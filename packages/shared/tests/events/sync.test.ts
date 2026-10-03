import { describe, expect, test } from 'bun:test';
import { syncActionSchema } from '../../src/events/sync.ts';

const valid = {
  syncId: 7,
  organizationId: 'o1',
  scopes: ['workspace:o1'],
  action: 'insert',
  model: 'member',
  modelId: 'm1',
  data: {},
  actor: { type: 'user', id: 'u1' },
  at: new Date(0).toISOString(),
};

describe('syncActionSchema', () => {
  test('accepts a CRM model', () => {
    expect(syncActionSchema.parse({ ...valid, model: 'lead' }).model).toBe('lead');
  });

  test('rejects an Orbit-only model', () => {
    expect(syncActionSchema.safeParse({ ...valid, model: 'issue' }).success).toBe(false);
  });

  test('requires at least one scope', () => {
    expect(syncActionSchema.safeParse({ ...valid, scopes: [] }).success).toBe(false);
  });
});
