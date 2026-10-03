import type { ActivityRow, CompanyRow, EmploymentRow, PersonRow } from '@gravity/shared/records';

const AT = '2026-10-01T10:00:00.000Z';

export function personFixture(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: 'per1',
    name: 'Ada Lovelace',
    emails: ['ada@acme.io'],
    primaryEmail: 'ada@acme.io',
    phones: [],
    linkedinUrl: null,
    linkedinProviderId: null,
    location: null,
    timezone: null,
    doNotContact: false,
    fields: {},
    companyId: null,
    companyName: null,
    title: null,
    syncId: 5,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    ...overrides,
  };
}

export function companyFixture(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: 'c1',
    name: 'Acme',
    domains: ['acme.io'],
    primaryDomain: 'acme.io',
    size: null,
    segment: null,
    location: null,
    fields: {},
    syncId: 5,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    ...overrides,
  };
}

export function employmentFixture(overrides: Partial<EmploymentRow> = {}): EmploymentRow {
  return {
    id: 'e1',
    personId: 'per1',
    companyId: 'c1',
    companyName: 'Acme',
    title: 'Engineer',
    startedAt: null,
    endedAt: null,
    isCurrent: true,
    syncId: 30,
    ...overrides,
  };
}

export function activityFixture(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'a1',
    kind: 'lead.stage_changed',
    actor: { type: 'user', id: 'u1' },
    occurredAt: AT,
    payload: {},
    links: [{ entityType: 'lead', entityId: 'l1' }],
    syncId: 40,
    ...overrides,
  };
}
