import { describe, expect, test } from 'bun:test';
import { serverMessageSchema } from '../../src/events/message.ts';
import {
  syncActionSchema,
  syncCatchupQuerySchema,
  syncCatchupSchema,
} from '../../src/events/sync.ts';

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

describe('syncCatchupQuerySchema', () => {
  test('requires the workspace the caller is catching up on', () => {
    expect(syncCatchupQuerySchema.safeParse({ since: '4' }).success).toBe(false);
  });

  test('coerces the cursors and leaves the true cursor optional', () => {
    expect(syncCatchupQuerySchema.parse({ organizationId: 'o1', since: '4' })).toEqual({
      organizationId: 'o1',
      since: 4,
    });
    expect(
      syncCatchupQuerySchema.parse({ organizationId: 'o1', since: '4', cursor: '1004' }),
    ).toEqual({ organizationId: 'o1', since: 4, cursor: 1004 });
  });

  test('leaves since out when only the cursor is sent, so the server picks the window', () => {
    expect(syncCatchupQuerySchema.parse({ organizationId: 'o1', cursor: '1004' })).toEqual({
      organizationId: 'o1',
      cursor: 1004,
    });
  });
});

describe('syncCatchupSchema', () => {
  test('requires the reset signal', () => {
    const page = { syncId: 3, actions: [], truncated: false };
    expect(syncCatchupSchema.safeParse(page).success).toBe(false);
    expect(syncCatchupSchema.parse({ ...page, reset: true }).reset).toBe(true);
  });
});

describe('serverMessageSchema', () => {
  test('carries a resync control frame', () => {
    expect(serverMessageSchema.parse({ type: 'resync' })).toEqual({ type: 'resync' });
  });
});
