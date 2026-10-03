import { describe, expect, test } from 'bun:test';
import { savedViewCreateSchema, viewPreferenceSchema } from '../../src/validators/views.ts';

describe('savedViewCreateSchema', () => {
  test('defaults to a private view with an empty filter', () => {
    expect(savedViewCreateSchema.parse({ object: 'lead', name: 'Hot' })).toMatchObject({
      visibility: 'private',
      pipelineId: null,
      filter: { kind: 'group', combinator: 'and', children: [] },
    });
  });

  test('refuses a filter with stray keys', () => {
    const result = savedViewCreateSchema.safeParse({
      object: 'lead',
      name: 'Hot',
      filter: { kind: 'group', children: [], owner: 'me' },
    });
    expect(result.success).toBe(false);
  });
});

describe('viewPreferenceSchema', () => {
  test('defaults scope, layout and display', () => {
    expect(viewPreferenceSchema.parse({ page: 'leads' })).toEqual({
      page: 'leads',
      scope: '',
      layout: 'list',
      display: {},
    });
  });
});
