import { describe, expect, test } from 'bun:test';
import type { Actor } from '../../src/events/actor.ts';
import {
  type FieldDefinitionLike,
  fieldValuesSchema,
  mergeFields,
} from '../../src/validators/fields.ts';

const definitions: FieldDefinitionLike[] = [
  {
    key: 'industry',
    type: 'select',
    options: [
      { value: 'saas', label: 'SaaS' },
      { value: 'agency', label: 'Agency' },
    ],
  },
  { key: 'seats', type: 'number', options: [] },
  {
    key: 'tags',
    type: 'multi_select',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
  { key: 'renewal', type: 'date', options: [] },
  { key: 'site', type: 'url', options: [] },
];

describe('fieldValuesSchema', () => {
  test('accepts valid values and null', () => {
    const schema = fieldValuesSchema(definitions);
    expect(
      schema.parse({
        industry: 'saas',
        seats: 12,
        tags: ['a', 'b'],
        renewal: '2027-01-31',
        site: null,
      }),
    ).toEqual({
      industry: 'saas',
      seats: 12,
      tags: ['a', 'b'],
      renewal: '2027-01-31',
      site: null,
    });
  });

  test('names an unknown field and the known ones', () => {
    const result = fieldValuesSchema(definitions).safeParse({ colour: 'red' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('There is no custom field called colour');
    expect(result.error?.issues[0]?.message).toContain('industry');
  });

  test('lists the valid options for a bad select value', () => {
    const result = fieldValuesSchema(definitions).safeParse({ industry: 'retail' });
    expect(result.error?.issues[0]?.message).toBe('Pick one of: saas, agency.');
  });

  test('refuses an impossible date and a repeated multi value', () => {
    expect(fieldValuesSchema(definitions).safeParse({ renewal: '2027-02-30' }).success).toBe(false);
    expect(fieldValuesSchema(definitions).safeParse({ tags: ['a', 'a'] }).success).toBe(false);
  });

  test('ignores archived definitions', () => {
    const archived = [
      { key: 'old', type: 'text' as const, options: [], archivedAt: '2026-01-01T00:00:00.000Z' },
    ];
    expect(fieldValuesSchema(archived).safeParse({ old: 'x' }).success).toBe(false);
  });
});

describe('mergeFields', () => {
  const human: Actor = { type: 'user', id: 'u1' };
  const agent: Actor = { type: 'agent', id: 'claude' };
  const at = new Date('2026-10-03T09:00:00.000Z');

  test('an agent cannot overwrite a value a human set, and it becomes a suggestion', () => {
    const first = mergeFields({}, {}, { industry: 'saas' }, human, at);
    const second = mergeFields(
      first.fields,
      first.meta,
      { industry: 'agency', seats: 3 },
      agent,
      at,
    );
    expect(second.fields).toEqual({ industry: 'saas', seats: 3 });
    expect(second.suggestions).toEqual({ industry: 'agency' });
    expect(second.meta['seats']).toEqual({
      source: 'agent',
      actorId: 'claude',
      at: at.toISOString(),
    });
  });

  test('a human overwrites an agent value and null clears a key', () => {
    const first = mergeFields({}, {}, { seats: 3 }, agent, at);
    const second = mergeFields(first.fields, first.meta, { seats: 5 }, human, at);
    expect(second.fields).toEqual({ seats: 5 });
    const cleared = mergeFields(second.fields, second.meta, { seats: null }, human, at);
    expect(cleared.fields).toEqual({});
    expect(cleared.meta).toEqual({});
  });
});
