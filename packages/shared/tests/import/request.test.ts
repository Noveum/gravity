import { describe, expect, test } from 'bun:test';
import { importRequestSchema } from '../../src/import/request.ts';

const base = { format: 'csv', content: 'Name\nAda\n', mapping: { Name: 'person.name' } };

describe('importRequestSchema', () => {
  test('a leads import needs a pipeline and the others refuse one', () => {
    expect(importRequestSchema.safeParse({ ...base, target: 'leads' }).success).toBe(false);
    expect(
      importRequestSchema.safeParse({ ...base, target: 'leads', pipelineId: 'p1' }).success,
    ).toBe(true);
    expect(
      importRequestSchema.safeParse({ ...base, target: 'people', pipelineId: 'p1' }).success,
    ).toBe(false);
  });

  test('normalizes the source name and defaults the owner to me', () => {
    const parsed = importRequestSchema.parse({
      ...base,
      target: 'people',
      source: ' CRM-Export.2026 ',
    });
    expect(parsed).toMatchObject({
      source: 'crm-export.2026',
      defaultOwner: 'me',
      pipelineId: null,
    });
    expect(
      importRequestSchema.safeParse({ ...base, target: 'people', source: 'has space' }).success,
    ).toBe(false);
  });

  test('refuses an empty file, an unknown format and an unknown column', () => {
    expect(importRequestSchema.safeParse({ ...base, target: 'people', content: '' }).success).toBe(
      false,
    );
    expect(
      importRequestSchema.safeParse({ ...base, target: 'people', format: 'xlsx' }).success,
    ).toBe(false);
    expect(
      importRequestSchema.safeParse({ ...base, target: 'people', mapping: { Name: 'person.x' } })
        .success,
    ).toBe(false);
  });
});
