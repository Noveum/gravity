import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import { CONTEXT_TOKENS } from '../../src/constants/crm.ts';
import { emptyFilterGroup, inCondition, replaceCondition } from '../../src/filters/ast.ts';
import { encodeFilter } from '../../src/filters/codec.ts';
import {
  CURSOR_MAX_LENGTH,
  contextQuerySchema,
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

describe('contextQuerySchema', () => {
  test('the budget defaults, is coerced from the query string and trims the ref', () => {
    expect(contextQuerySchema.parse({ ref: ' ada@vela.example ' })).toEqual({
      ref: 'ada@vela.example',
      maxTokens: CONTEXT_TOKENS.default,
    });
    expect(contextQuerySchema.parse({ ref: 'x', maxTokens: '700' }).maxTokens).toBe(700);
  });

  test('refuses a blank or oversized ref and a budget outside the bounds', () => {
    expect(() => contextQuerySchema.parse({ ref: '  ' })).toThrow(ZodError);
    expect(() => contextQuerySchema.parse({ ref: 'x'.repeat(501) })).toThrow(ZodError);
    for (const maxTokens of [CONTEXT_TOKENS.min - 1, CONTEXT_TOKENS.max + 1, 1.5, 'many']) {
      expect(() => contextQuerySchema.parse({ ref: 'x', maxTokens })).toThrow(ZodError);
    }
  });
});
