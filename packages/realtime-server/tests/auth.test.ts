import { beforeEach, describe, expect, test } from 'bun:test';
import { createWorkspace, resetDatabase } from '@gravity/core/test-support';
import {
  REALTIME_TICKET_TTL_MS,
  type RealtimeTicketPayload,
  signRealtimeTicket,
} from '@gravity/shared/events/ticket';
import { authorizeScope, type ConnectionPrincipal, readTicketFrame } from '../src/auth.ts';

let principal: ConnectionPrincipal;
let otherOrganizationId = '';

beforeEach(async () => {
  await resetDatabase();
  const mine = await createWorkspace('Mine');
  const other = await createWorkspace('Other');
  otherOrganizationId = other.organizationId;
  principal = {
    userId: mine.adminUser.id,
    sessionId: 's1',
    name: 'Ada',
    image: null,
    organizationId: mine.organizationId,
    role: 'admin',
  };
});

describe('authorizeScope', () => {
  test('allows the caller own workspace and user scopes', async () => {
    expect(await authorizeScope(principal, `workspace:${principal.organizationId}`)).toBe(true);
    expect(await authorizeScope(principal, `user:${principal.userId}`)).toBe(true);
  });

  test('refuses another workspace and another user', async () => {
    expect(await authorizeScope(principal, `workspace:${otherOrganizationId}`)).toBe(false);
    expect(await authorizeScope(principal, 'user:someone-else')).toBe(false);
  });

  test('refuses unknown and malformed scopes', async () => {
    expect(await authorizeScope(principal, 'team:t1')).toBe(false);
    expect(await authorizeScope(principal, 'brand:')).toBe(false);
  });

  test('refuses record scopes until their tables exist', async () => {
    expect(await authorizeScope(principal, 'brand:b1')).toBe(false);
    expect(await authorizeScope(principal, 'person:p1')).toBe(false);
  });
});

const SECRET = 'secret-value-that-is-long-enough';
const NOW = 1_800_000_000_000;

function payload(overrides: Partial<RealtimeTicketPayload> = {}): RealtimeTicketPayload {
  return {
    userId: 'user_1',
    organizationId: 'org_1',
    sessionId: 'session_1',
    exp: NOW + REALTIME_TICKET_TTL_MS,
    ...overrides,
  };
}

function frame(ticket: string): string {
  return JSON.stringify({ type: 'auth', ticket });
}

describe('readTicketFrame', () => {
  test('returns the payload of a valid first frame', () => {
    const raw = frame(signRealtimeTicket(payload(), SECRET));
    expect(readTicketFrame(raw, SECRET, NOW)).toEqual(payload());
  });

  test('rejects a frame that is not valid json', () => {
    expect(readTicketFrame('not json', SECRET, NOW)).toBeNull();
  });

  test('rejects a frame that is not an auth message', () => {
    expect(readTicketFrame(JSON.stringify({ type: 'ping' }), SECRET, NOW)).toBeNull();
    expect(readTicketFrame(JSON.stringify({ type: 'auth' }), SECRET, NOW)).toBeNull();
  });

  test('rejects a forged ticket', () => {
    expect(readTicketFrame(frame('forged.ticket'), SECRET, NOW)).toBeNull();
  });

  test('rejects an expired ticket', () => {
    const raw = frame(signRealtimeTicket(payload({ exp: NOW - 1 }), SECRET));
    expect(readTicketFrame(raw, SECRET, NOW)).toBeNull();
  });
});
