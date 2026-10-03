import { describe, expect, it } from 'bun:test';
import type { PresenceMessage } from '@gravity/shared/events';
import { PresenceStore } from '../src/presence.ts';

function message(at: number, overrides: Partial<PresenceMessage> = {}): PresenceMessage {
  return {
    organizationId: 'org_1',
    scope: 'person:person_1',
    kind: 'viewing',
    userId: 'user_1',
    name: 'Ada',
    image: null,
    at: new Date(at).toISOString(),
    ...overrides,
  };
}

describe('PresenceStore', () => {
  it('keeps the latest message per user on a scope', () => {
    const store = new PresenceStore(1_000);
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(store.record(message(now), now)).toBe(true);
    expect(store.record(message(now + 10, { kind: 'typing' }), now + 10)).toBe(true);
    expect(store.record(message(now + 10, { userId: 'user_2' }), now + 10)).toBe(true);

    const snapshot = store.snapshot('person:person_1', now + 20);
    expect(snapshot).toHaveLength(2);
    expect(snapshot.find((entry) => entry.userId === 'user_1')?.kind).toBe('typing');
  });

  it('rejects a message whose original lifetime already elapsed', () => {
    const store = new PresenceStore(1_000);
    const now = Date.parse('2026-01-01T00:00:02.000Z');

    expect(store.record(message(now - 1_001), now)).toBe(false);
    expect(store.snapshot('person:person_1', now)).toEqual([]);
  });

  it('hides expired entries from snapshots and sweeps them away', () => {
    const store = new PresenceStore(1_000);
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    store.record(message(now), now);

    expect(store.snapshot('person:person_1', now + 1_000)).toEqual([]);
    store.sweep(now + 1_000);
    expect(store.record(message(now + 1_000), now + 1_000)).toBe(true);
    expect(store.snapshot('person:person_1', now + 1_001)).toHaveLength(1);
  });
});
