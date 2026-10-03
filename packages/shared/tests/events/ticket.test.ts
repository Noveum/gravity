import { describe, expect, test } from 'bun:test';
import {
  REALTIME_TICKET_TTL_MS,
  type RealtimeTicketPayload,
  signRealtimeTicket,
  verifyRealtimeTicket,
} from '../../src/events/ticket.ts';

const SECRET = 'a-ticket-secret-long-enough-to-sign';
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

function tamperSignature(ticket: string): string {
  const separator = ticket.indexOf('.');
  const first = ticket[separator + 1] === 'A' ? 'Q' : 'A';
  return `${ticket.slice(0, separator + 1)}${first}${ticket.slice(separator + 2)}`;
}

describe('realtime tickets', () => {
  test('a valid ticket verifies to its payload', () => {
    const ticket = signRealtimeTicket(payload(), SECRET);
    expect(verifyRealtimeTicket(ticket, SECRET, NOW)).toEqual(payload());
  });

  test('a tampered signature is rejected', () => {
    const ticket = signRealtimeTicket(payload(), SECRET);
    expect(verifyRealtimeTicket(tamperSignature(ticket), SECRET, NOW)).toBeNull();
  });

  test('a tampered body is rejected even with the original signature', () => {
    const [, signature] = signRealtimeTicket(payload(), SECRET).split('.');
    const forgedBody = Buffer.from(JSON.stringify(payload({ userId: 'user_2' }))).toString(
      'base64url',
    );
    expect(verifyRealtimeTicket(`${forgedBody}.${signature}`, SECRET, NOW)).toBeNull();
  });

  test('a ticket signed with another secret is rejected', () => {
    const ticket = signRealtimeTicket(payload(), 'another-secret-long-enough-to-sign');
    expect(verifyRealtimeTicket(ticket, SECRET, NOW)).toBeNull();
  });

  test('an expired ticket is rejected', () => {
    const ticket = signRealtimeTicket(payload({ exp: NOW }), SECRET);
    expect(verifyRealtimeTicket(ticket, SECRET, NOW)).toBeNull();
    expect(verifyRealtimeTicket(ticket, SECRET, NOW - 1)).not.toBeNull();
  });

  test('a malformed ticket is rejected', () => {
    expect(verifyRealtimeTicket('no-separator', SECRET, NOW)).toBeNull();
    expect(verifyRealtimeTicket('body.', SECRET, NOW)).toBeNull();
    expect(verifyRealtimeTicket('.signature', SECRET, NOW)).toBeNull();
  });
});
