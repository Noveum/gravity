import { describe, expect, test } from 'bun:test';
import {
  conditionsOf,
  emptyFilterGroup,
  filterGroupSchema,
  filterGroupWriteSchema,
  inCondition,
  MAX_FILTER_CONDITIONS,
  removeCondition,
  replaceCondition,
} from '../../src/filters/ast.ts';

describe('filterGroupSchema', () => {
  test('parses a nested group and defaults negate to false', () => {
    const parsed = filterGroupSchema.parse({
      kind: 'group',
      combinator: 'or',
      children: [
        { kind: 'condition', property: 'stage', operator: 'in', values: ['s1'] },
        {
          kind: 'group',
          combinator: 'and',
          children: [
            { kind: 'condition', property: 'fields.industry', operator: 'in', values: ['saas'] },
          ],
        },
      ],
    });
    expect(conditionsOf(parsed).map((condition) => [condition.property, condition.negate])).toEqual(
      [
        ['stage', false],
        ['fields.industry', false],
      ],
    );
  });

  test('refuses a range without bounds and a property that is not a key', () => {
    const range = {
      kind: 'condition',
      property: 'priority',
      operator: 'range',
      from: null,
      to: null,
    };
    expect(filterGroupSchema.safeParse({ kind: 'group', children: [range] }).success).toBe(false);
    const bad = { kind: 'condition', property: 'drop table', operator: 'in', values: ['x'] };
    expect(filterGroupSchema.safeParse({ kind: 'group', children: [bad] }).success).toBe(false);
  });

  test('refuses more conditions than the limit', () => {
    const children = Array.from({ length: MAX_FILTER_CONDITIONS + 1 }, () =>
      inCondition('stage', ['s1']),
    );
    expect(filterGroupSchema.safeParse({ kind: 'group', children }).success).toBe(false);
  });
});

describe('filterGroupWriteSchema', () => {
  test('names stray keys instead of silently dropping them', () => {
    const result = filterGroupWriteSchema.safeParse({ kind: 'group', children: [], stage: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('stage');
  });
});

describe('condition helpers', () => {
  test('replace swaps a condition for the same property and remove drops it', () => {
    const first = replaceCondition(emptyFilterGroup(), inCondition('stage', ['a']));
    const second = replaceCondition(first, inCondition('stage', ['b']));
    expect(conditionsOf(second)).toHaveLength(1);
    expect(conditionsOf(second)[0]).toMatchObject({ values: ['b'] });
    expect(conditionsOf(removeCondition(second, 'stage'))).toHaveLength(0);
  });
});
