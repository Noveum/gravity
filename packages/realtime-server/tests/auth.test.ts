import { beforeEach, describe, expect, test } from 'bun:test';
import { archiveBrand, createBrand, upsertCompany, upsertPerson } from '@gravity/core';
import { createWorkspace, resetDatabase, type TestWorkspace } from '@gravity/core/test-support';
import {
  REALTIME_TICKET_TTL_MS,
  type RealtimeTicketPayload,
  signRealtimeTicket,
} from '@gravity/shared/events/ticket';
import { authorizeScope, type ConnectionPrincipal, readTicketFrame } from '../src/auth.ts';

let principal: ConnectionPrincipal;
let mine: TestWorkspace;
let other: TestWorkspace;
let otherOrganizationId = '';

beforeEach(async () => {
  await resetDatabase();
  mine = await createWorkspace('Mine');
  other = await createWorkspace('Other');
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
});

describe('record scopes', () => {
  test('admits brands, pipelines, people and companies of the caller workspace', async () => {
    const owner = { principal: mine.admin };
    const brand = await createBrand(owner, { name: 'Yodu' });
    const person = await upsertPerson(owner, { name: 'Ada' });
    const company = await upsertCompany(owner, { name: 'Acme', domains: ['acme.io'] });
    expect(await authorizeScope(principal, `brand:${brand.brand.id}`)).toBe(true);
    expect(await authorizeScope(principal, `pipeline:${brand.pipeline.id}`)).toBe(true);
    expect(await authorizeScope(principal, `person:${person.person.id}`)).toBe(true);
    expect(await authorizeScope(principal, `company:${company.company.id}`)).toBe(true);
  });

  test('refuses the same kinds from another workspace and ids that do not exist', async () => {
    const owner = { principal: other.admin };
    const brand = await createBrand(owner, { name: 'Zeta' });
    const person = await upsertPerson(owner, { name: 'Zed' });
    const company = await upsertCompany(owner, { name: 'Zeta Co', domains: ['zeta.io'] });
    expect(await authorizeScope(principal, `brand:${brand.brand.id}`)).toBe(false);
    expect(await authorizeScope(principal, `pipeline:${brand.pipeline.id}`)).toBe(false);
    expect(await authorizeScope(principal, `person:${person.person.id}`)).toBe(false);
    expect(await authorizeScope(principal, `company:${company.company.id}`)).toBe(false);
    expect(await authorizeScope(principal, 'company:does-not-exist')).toBe(false);
  });

  test('refuses an archived brand and its archived pipeline', async () => {
    const owner = { principal: mine.admin };
    const brand = await createBrand(owner, { name: 'Retired' });
    expect(await authorizeScope(principal, `brand:${brand.brand.id}`)).toBe(true);
    await archiveBrand(owner, brand.brand.id);
    expect(await authorizeScope(principal, `brand:${brand.brand.id}`)).toBe(false);
    expect(await authorizeScope(principal, `pipeline:${brand.pipeline.id}`)).toBe(false);
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
