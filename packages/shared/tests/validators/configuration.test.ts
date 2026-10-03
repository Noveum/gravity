import { describe, expect, test } from 'bun:test';
import {
  brandCreateSchema,
  fieldDefinitionCreateSchema,
  pipelineKeySchema,
  stageReorderSchema,
} from '../../src/validators/configuration.ts';

describe('pipelineKeySchema', () => {
  test('trims and uppercases', () => {
    expect(pipelineKeySchema.parse(' yod ')).toBe('YOD');
  });

  test('refuses one letter, six letters and digits', () => {
    for (const bad of ['Y', 'ABCDEF', 'AB1']) {
      expect(pipelineKeySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('brandCreateSchema', () => {
  test('normalises the domain and defaults the colour', () => {
    const parsed = brandCreateSchema.parse({ name: ' Yodu ', domain: 'https://www.yodu.ai/' });
    expect(parsed).toMatchObject({ name: 'Yodu', domain: 'yodu.ai', color: 'blue', signature: '' });
  });
});

describe('fieldDefinitionCreateSchema', () => {
  test('a select field needs options and a text field refuses them', () => {
    const base = { object: 'lead', key: 'industry', label: 'Industry' };
    expect(fieldDefinitionCreateSchema.safeParse({ ...base, type: 'select' }).success).toBe(false);
    expect(
      fieldDefinitionCreateSchema.safeParse({
        ...base,
        type: 'text',
        options: [{ value: 'a', label: 'A' }],
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionCreateSchema.parse({
        ...base,
        type: 'select',
        options: [{ value: 'saas', label: 'SaaS' }],
      }).pipelineId,
    ).toBeNull();
  });

  test('refuses duplicate option values', () => {
    const result = fieldDefinitionCreateSchema.safeParse({
      object: 'person',
      key: 'tier',
      label: 'Tier',
      type: 'select',
      options: [
        { value: 'a', label: 'A' },
        { value: 'a', label: 'Again' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('stageReorderSchema', () => {
  test('refuses a repeated stage id', () => {
    expect(stageReorderSchema.safeParse({ pipelineId: 'p1', stageIds: ['a', 'a'] }).success).toBe(
      false,
    );
  });
});
