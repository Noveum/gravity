import { describe, expect, test } from 'bun:test';
import {
  companyInputSchema,
  companyRefSchema,
  leadBulkSchema,
  leadChangeSchema,
  leadPatchSchema,
  personInputSchema,
  timezoneSchema,
} from '../../src/validators/records.ts';

describe('companyRefSchema', () => {
  test('accepts an id, a domain with or without a name, and a bare name', () => {
    expect(companyRefSchema.parse({ id: 'c1' })).toEqual({ id: 'c1' });
    expect(companyRefSchema.parse({ domain: 'https://www.Acme.com/', name: 'Acme' })).toEqual({
      domain: 'acme.com',
      name: 'Acme',
    });
    expect(companyRefSchema.parse({ domain: 'acme.com' })).toEqual({ domain: 'acme.com' });
    expect(companyRefSchema.parse({ name: ' Acme ' })).toEqual({ name: 'Acme' });
  });

  test('a present but invalid id fails instead of falling back to the name', () => {
    expect(companyRefSchema.safeParse({ id: '' }).success).toBe(false);
    expect(companyRefSchema.safeParse({ id: '', name: 'Acme' }).success).toBe(false);
  });

  test('a present but invalid domain fails with its own message', () => {
    const result = companyRefSchema.safeParse({ domain: 'bad', name: 'Acme' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Use a domain like acme.com.');
  });

  test('refuses an id alongside other keys, an unknown key and an empty object', () => {
    expect(companyRefSchema.safeParse({ id: 'c1', name: 'Acme' }).success).toBe(false);
    expect(companyRefSchema.safeParse({ name: 'Acme', colour: 'red' }).success).toBe(false);
    expect(companyRefSchema.safeParse({}).success).toBe(false);
  });
});

describe('companyInputSchema', () => {
  test('normalises and dedupes domains', () => {
    const parsed = companyInputSchema.parse({
      name: 'Acme',
      domains: ['https://www.acme.com', 'ACME.com', 'acme.io'],
    });
    expect(parsed.domains).toEqual(['acme.com', 'acme.io']);
    expect(parsed.fields).toEqual({});
  });

  test('refuses a domain that is not one', () => {
    expect(companyInputSchema.safeParse({ name: 'Acme', domains: ['nope'] }).success).toBe(false);
  });
});

describe('personInputSchema', () => {
  test('canonicalises the LinkedIn URL and dedupes emails and phones', () => {
    const parsed = personInputSchema.parse({
      name: 'Ada',
      linkedinUrl: 'linkedin.com/in/Ada-Lovelace/?trk=x',
      emails: ['Ada@Acme.io', 'ada@acme.io'],
      phones: ['+4412345', '+4412345'],
    });
    expect(parsed.linkedinUrl).toBe('https://www.linkedin.com/in/ada-lovelace');
    expect(parsed.emails).toEqual(['ada@acme.io']);
    expect(parsed.phones).toEqual(['+4412345']);
    expect(parsed.company).toBeNull();
  });

  test('refuses a company page as a LinkedIn profile', () => {
    expect(
      personInputSchema.safeParse({
        name: 'Ada',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
      }).success,
    ).toBe(false);
  });

  test('carries a company reference through the same strict rules', () => {
    expect(
      personInputSchema.safeParse({ name: 'Ada', company: { id: '', name: 'Acme' } }).success,
    ).toBe(false);
    expect(personInputSchema.parse({ name: 'Ada', company: { name: 'Acme' } }).company).toEqual({
      name: 'Acme',
    });
  });
});

describe('leadPatchSchema', () => {
  test('refuses unknown keys, an empty patch and a priority outside 0 to 4', () => {
    expect(leadPatchSchema.safeParse({ priority: 1, colour: 'red' }).success).toBe(false);
    expect(leadPatchSchema.safeParse({}).success).toBe(false);
    expect(leadPatchSchema.safeParse({ priority: 5 }).success).toBe(false);
    expect(leadPatchSchema.safeParse({ priority: 1.5 }).success).toBe(false);
  });

  test('accepts explicit nulls as a change', () => {
    expect(leadPatchSchema.parse({ ownerId: null })).toEqual({ ownerId: null });
    expect(leadPatchSchema.parse({ priority: 4, nextActionAt: '2026-10-05T09:00:00Z' })).toEqual({
      priority: 4,
      nextActionAt: '2026-10-05T09:00:00Z',
    });
  });
});

describe('leadChangeSchema', () => {
  test('discriminates update, hold and close', () => {
    expect(leadChangeSchema.parse({ type: 'update', patch: { priority: 2 } }).type).toBe('update');
    expect(leadChangeSchema.parse({ type: 'hold', reason: ' Later ' })).toEqual({
      type: 'hold',
      reason: 'Later',
      until: null,
    });
    expect(leadChangeSchema.parse({ type: 'close' })).toEqual({ type: 'close' });
  });

  test('refuses a hold without a reason, an update without a patch and an unknown type', () => {
    expect(leadChangeSchema.safeParse({ type: 'hold', reason: '  ' }).success).toBe(false);
    expect(leadChangeSchema.safeParse({ type: 'update' }).success).toBe(false);
    expect(leadChangeSchema.safeParse({ type: 'delete' }).success).toBe(false);
  });
});

describe('leadBulkSchema', () => {
  const change = { type: 'close' } as const;

  test('refuses a repeated lead id and an empty list', () => {
    expect(leadBulkSchema.safeParse({ leadIds: ['a', 'a'], change }).success).toBe(false);
    expect(leadBulkSchema.safeParse({ leadIds: [], change }).success).toBe(false);
  });

  test('caps the batch at 500 leads', () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `lead-${index}`);
    expect(leadBulkSchema.safeParse({ leadIds: ids(500), change }).success).toBe(true);
    expect(leadBulkSchema.safeParse({ leadIds: ids(501), change }).success).toBe(false);
  });
});

describe('timezoneSchema', () => {
  test('accepts IANA zones and refuses everything else', () => {
    expect(timezoneSchema.parse(' Europe/London ')).toBe('Europe/London');
    expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
    expect(timezoneSchema.safeParse('').success).toBe(false);
  });
});
