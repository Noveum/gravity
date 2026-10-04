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

  test('a source id column needs a source name of its own', () => {
    const ids = { ...base, target: 'people', mapping: { Name: 'person.name', Ref: 'sourceId' } };
    const unnamed = importRequestSchema.safeParse(ids);
    expect(unnamed.success).toBe(false);
    expect(unnamed.error?.issues[0]?.path).toEqual(['source']);
    expect(importRequestSchema.safeParse({ ...ids, source: 'import' }).success).toBe(false);
    expect(importRequestSchema.safeParse({ ...ids, source: ' Import ' }).success).toBe(false);
    expect(importRequestSchema.parse({ ...ids, source: 'hubspot' }).source).toBe('hubspot');
    expect(importRequestSchema.parse({ ...base, target: 'people' }).source).toBe('import');
  });

  test('a run can start at a row and stop after a number of rows', () => {
    const people = { ...base, target: 'people' };
    expect(importRequestSchema.parse(people)).toMatchObject({ startRow: 1, rowLimit: null });
    expect(importRequestSchema.parse({ ...people, startRow: 4, rowLimit: 500 })).toMatchObject({
      startRow: 4,
      rowLimit: 500,
    });
    for (const bad of [{ startRow: 0 }, { startRow: 1.5 }, { rowLimit: 0 }, { startRow: '4' }]) {
      expect(importRequestSchema.safeParse({ ...people, ...bad }).success).toBe(false);
    }
  });
});
