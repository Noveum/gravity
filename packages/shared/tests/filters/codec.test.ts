import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  containsCondition,
  emptyFilterGroup,
  inCondition,
  replaceCondition,
} from '../../src/filters/ast.ts';
import {
  decodeFilter,
  decodeListQuery,
  encodeFilter,
  encodeListQuery,
  filterGroupQuerySchema,
} from '../../src/filters/codec.ts';

describe('list query codec', () => {
  test('an empty query encodes to an empty string', () => {
    expect(encodeListQuery({ filter: emptyFilterGroup(), q: '  ' })).toBe('');
  });

  test('round trips a filter and a search term in a stable order', () => {
    const filter = replaceCondition(emptyFilterGroup(), inCondition('stage', ['s1']));
    const encoded = encodeListQuery({ filter, q: 'ada' });
    expect(encoded.startsWith('filter=')).toBe(true);
    expect(encoded.endsWith('&q=ada')).toBe(true);
    expect(decodeListQuery(encoded)).toEqual({ filter, q: 'ada' });
  });

  test('garbage in the filter parameter decodes to no filter', () => {
    expect(decodeListQuery('filter=%7Bnope&q=x')).toEqual({ filter: emptyFilterGroup(), q: 'x' });
  });
});

describe('canonical encoding', () => {
  const built = replaceCondition(
    replaceCondition(emptyFilterGroup(), inCondition('stage', ['s1', 's2'], true)),
    containsCondition('person', 'ada'),
  );

  test('encode(decode(x)) is x for a filter built with the condition helpers', () => {
    const encoded = encodeFilter(built);
    expect(encodeFilter(decodeFilter(encoded))).toBe(encoded);
  });

  test('keys are written in schema order whatever order the object was built in', () => {
    const encoded = encodeFilter(built);
    expect(encoded).toBe(
      '{"kind":"group","combinator":"and","children":[' +
        '{"kind":"condition","property":"stage","negate":true,"operator":"in","values":["s1","s2"]},' +
        '{"kind":"condition","property":"person","negate":false,"operator":"contains","value":"ada"}]}',
    );
    expect(encodeFilter(decodeFilter(encoded))).toBe(encoded);
  });

  test('two spellings of one filter encode to the same string', () => {
    const shuffled = JSON.stringify({
      children: [
        { values: ['s1'], operator: 'in', negate: false, property: 'stage', kind: 'condition' },
      ],
      combinator: 'and',
      kind: 'group',
    });
    const direct = replaceCondition(emptyFilterGroup(), inCondition('stage', ['s1']));
    expect(encodeFilter(decodeFilter(shuffled))).toBe(encodeFilter(direct));
  });

  test('a list query keeps the same filter string through a round trip', () => {
    const encoded = encodeListQuery({ filter: built, q: 'ada' });
    expect(encodeListQuery(decodeListQuery(encoded))).toBe(encoded);
  });
});

describe('filterGroupQuerySchema', () => {
  const schema = z.object({ filter: filterGroupQuerySchema });

  test('an absent or empty value is the empty filter', () => {
    expect(schema.parse({}).filter).toEqual(emptyFilterGroup());
    expect(schema.parse({ filter: '' }).filter).toEqual(emptyFilterGroup());
    expect(schema.parse({ filter: '   ' }).filter).toEqual(emptyFilterGroup());
  });

  test('parses a valid encoded filter', () => {
    const filter = replaceCondition(emptyFilterGroup(), inCondition('stage', ['s1']));
    expect(schema.parse({ filter: encodeFilter(filter) }).filter).toEqual(filter);
  });

  test('refuses unparseable JSON instead of dropping the filter', () => {
    expect(schema.safeParse({ filter: '{nope' }).success).toBe(false);
  });

  test('refuses a filter that fails the schema instead of dropping it', () => {
    const bad = JSON.stringify({
      kind: 'group',
      children: [{ kind: 'condition', property: 'drop table', operator: 'in', values: ['x'] }],
    });
    const result = schema.safeParse({ filter: bad });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(z.ZodError);
  });

  test('refuses a stray key on the group instead of dropping it', () => {
    const result = schema.safeParse({
      filter: JSON.stringify({ kind: 'group', children: [], owner: 'me' }),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('owner');
    expect(result.error).toBeInstanceOf(z.ZodError);
  });

  test('refuses a negated key on a condition instead of inverting the filter', () => {
    const result = schema.safeParse({
      filter: JSON.stringify({
        kind: 'group',
        children: [
          { kind: 'condition', property: 'stage', operator: 'in', values: ['s1'], negated: true },
        ],
      }),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('children[0].negated');
  });

  test('refuses nesting deeper than the limit without throwing', () => {
    let node: unknown = { kind: 'group', children: [] };
    for (let level = 0; level < 100_000; level += 1) node = { kind: 'group', children: [node] };
    const result = schema.safeParse({ filter: node });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('levels deep');
  });

  test('refuses deep nesting sent as an encoded string', () => {
    let node: unknown = { kind: 'group', children: [] };
    for (let level = 0; level < 40; level += 1) node = { kind: 'group', children: [node] };
    expect(schema.safeParse({ filter: JSON.stringify(node) }).success).toBe(false);
  });
});
