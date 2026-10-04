import { describe, expect, test } from 'bun:test';
import {
  customColumn,
  customFieldOf,
  importMappingSchema,
  isImportColumn,
  mappingIssues,
  suggestMapping,
} from '../../src/import/mapping.ts';

const definitions = [
  { object: 'person', key: 'seniority', label: 'Seniority' },
  { object: 'lead', key: 'deal_size', label: 'Deal size' },
  { object: 'deal', key: 'ignored', label: 'Ignored' },
];
const NO_FIELDS = { person: [], company: [], lead: [] };

describe('suggestMapping', () => {
  test('maps common headers and custom field labels for each target', () => {
    const headers = [
      'Full Name',
      'Work Email',
      'E-mail',
      'Company',
      'Website',
      'Job Title',
      'LinkedIn URL',
      'Stage',
      'Seniority',
      'Deal size',
      'Notes',
    ];
    expect(suggestMapping(headers, 'people', definitions)).toEqual({
      'Full Name': 'person.name',
      'Work Email': 'person.email',
      'E-mail': 'person.email',
      Company: 'company.name',
      Website: 'company.domain',
      'Job Title': 'person.title',
      'LinkedIn URL': 'person.linkedinUrl',
      Stage: 'ignore',
      Seniority: 'person.field.seniority',
      'Deal size': 'ignore',
      Notes: 'ignore',
    });
    const leads = suggestMapping(headers, 'leads', definitions);
    expect(leads['Stage']).toBe('lead.stage');
    expect(leads['Deal size']).toBe('lead.field.deal_size');
    expect(suggestMapping(['Name', 'Location'], 'companies', definitions)).toEqual({
      Name: 'ignore',
      Location: 'company.location',
    });
  });

  test('suggests a single column for each non repeatable field', () => {
    expect(
      suggestMapping(['Name', 'Full name', 'Seniority', 'seniority'], 'people', definitions),
    ).toEqual({
      Name: 'person.name',
      'Full name': 'ignore',
      Seniority: 'person.field.seniority',
      seniority: 'ignore',
    });
  });

  test('keeps a header named like an object prototype key', () => {
    const mapping = suggestMapping(['__proto__', 'constructor', 'Name'], 'people', definitions);
    expect(Object.keys(mapping)).toEqual(['__proto__', 'constructor', 'Name']);
    expect(Object.getPrototypeOf(mapping)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(mapping, '__proto__')?.value).toBe('ignore');
  });
});

describe('mappingIssues', () => {
  test('names every problem a mapping can have', () => {
    expect(
      mappingIssues(
        {
          Ghost: 'person.name',
          Stage: 'lead.stage',
          Tier: 'person.field.tier',
          A: 'person.title',
          B: 'person.title',
        },
        'people',
        ['Stage', 'Tier', 'A', 'B'],
        NO_FIELDS,
      ),
    ).toEqual([
      'The file has no column called Ghost.',
      'Lead stage cannot be imported into people.',
      'There is no person field called tier.',
      'B and A both map to Job title. Map each field once.',
    ]);
    expect(mappingIssues({ Email: 'person.email' }, 'people', ['Email'], NO_FIELDS)).toEqual([
      'Map a name column, or first and last name columns.',
    ]);
    expect(
      mappingIssues(
        { First: 'person.firstName', A: 'person.email', B: 'person.email' },
        'people',
        ['First', 'A', 'B'],
        NO_FIELDS,
      ),
    ).toEqual([]);
    expect(mappingIssues({ Size: 'company.size' }, 'companies', ['Size'], NO_FIELDS)).toEqual([
      'Map a company name or domain column.',
    ]);
  });

  test('the mapping schema accepts custom columns and refuses unknown ones', () => {
    expect(importMappingSchema.safeParse({ A: 'lead.field.deal_size' }).success).toBe(true);
    expect(importMappingSchema.safeParse({ A: 'person.secret' }).success).toBe(false);
    expect(importMappingSchema.safeParse({ A: 'person.field.Bad-Key' }).success).toBe(false);
    expect(importMappingSchema.safeParse({ A: 'deal.field.size' }).success).toBe(false);
  });

  test('the mapping schema never lets a header reach the prototype', () => {
    const parsed = importMappingSchema.parse(
      JSON.parse('{"__proto__":"person.name","constructor":"person.title"}'),
    );
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed, '__proto__')).toBe(false);
    expect(Object.hasOwn(parsed, 'constructor') ? parsed['constructor'] : null).toBe(
      'person.title',
    );
    expect(Reflect.get(Object.prototype, 'name')).toBeUndefined();
  });

  test('the mapping schema caps the number of mapped columns', () => {
    const many = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`c${index}`, 'ignore']),
    );
    expect(importMappingSchema.safeParse(many).success).toBe(false);
  });
});

describe('custom columns', () => {
  test('round trip through customColumn and customFieldOf', () => {
    const column = customColumn('company', 'tier');
    expect(column).toBe('company.field.tier');
    expect(isImportColumn(column)).toBe(true);
    expect(customFieldOf(column)).toEqual({ object: 'company', key: 'tier' });
    expect(customFieldOf('person.name')).toBeNull();
  });
});
