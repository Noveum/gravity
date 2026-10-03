import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import { emptyFilterGroup, inCondition, replaceCondition } from '../../src/filters/ast.ts';
import { encodeFilter } from '../../src/filters/codec.ts';
import { leadListQuerySchema, recordListQuerySchema } from '../../src/validators/lists.ts';

describe('list query schemas', () => {
  test('an absent filter is the empty filter and the limits default', () => {
    expect(leadListQuerySchema.parse({ pipelineId: 'p1' })).toMatchObject({
      filter: emptyFilterGroup(),
      q: '',
      limit: 500,
    });
    expect(recordListQuerySchema.parse({ filter: '' }).filter).toEqual(emptyFilterGroup());
  });

  test('an encoded filter in the query string is parsed', () => {
    const filter = replaceCondition(emptyFilterGroup(), inCondition('stage', ['s1']));
    expect(
      leadListQuerySchema.parse({ pipelineId: 'p1', filter: encodeFilter(filter) }).filter,
    ).toEqual(filter);
  });

  test('a malformed filter is a validation error, not an unfiltered list', () => {
    expect(() => leadListQuerySchema.parse({ pipelineId: 'p1', filter: '{nope' })).toThrow(
      ZodError,
    );
    expect(() =>
      recordListQuerySchema.parse({
        filter: JSON.stringify({ kind: 'group', children: [{ kind: 'condition' }] }),
      }),
    ).toThrow(ZodError);
  });
});
