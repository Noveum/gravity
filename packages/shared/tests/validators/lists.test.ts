import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import { emptyFilterGroup, inCondition, replaceCondition } from '../../src/filters/ast.ts';
import { encodeFilter } from '../../src/filters/codec.ts';
import {
  CURSOR_MAX_LENGTH,
  leadListQuerySchema,
  recordListQuerySchema,
  timelineQuerySchema,
} from '../../src/validators/lists.ts';

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

  test('a cursor for a 200 character name fits and one past the cap does not', () => {
    const encoded = Buffer.from(JSON.stringify(['x'.repeat(200), 'a-record-id'])).toString(
      'base64url',
    );
    expect(encoded.length).toBeGreaterThan(256);
    expect(recordListQuerySchema.parse({ cursor: encoded }).cursor).toBe(encoded);
    expect(leadListQuerySchema.parse({ pipelineId: 'p1', cursor: encoded }).cursor).toBe(encoded);
    expect(
      timelineQuerySchema.parse({ subjectType: 'person', subjectId: 'p1', cursor: encoded }).cursor,
    ).toBe(encoded);
    expect(() =>
      recordListQuerySchema.parse({ cursor: 'x'.repeat(CURSOR_MAX_LENGTH + 1) }),
    ).toThrow(ZodError);
  });
});
