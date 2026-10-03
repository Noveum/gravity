import { describe, expect, test } from 'bun:test';
import type { FilterGroup, FilterNode } from '../../src/filters/ast.ts';
import { evaluateFilter, matchesSearch } from '../../src/filters/evaluate.ts';
import type { FilterRegistry } from '../../src/filters/registry.ts';

interface Row {
  readonly owner: string | null;
  readonly priority: number;
  readonly name: string | null;
  readonly due: string | null;
  readonly tags: readonly string[];
  readonly vip: boolean | null;
  readonly stage: string;
}

const registry: FilterRegistry<Row> = {
  object: 'lead',
  properties: [
    { key: 'owner', label: 'Owner', kind: 'id', allowsMe: true, read: (row) => row.owner },
    { key: 'priority', label: 'Priority', kind: 'number', read: (row) => row.priority },
    { key: 'name', label: 'Name', kind: 'text', read: (row) => row.name },
    { key: 'due', label: 'Due', kind: 'date', read: (row) => row.due },
    { key: 'tags', label: 'Tags', kind: 'multi', read: (row) => row.tags },
    { key: 'vip', label: 'VIP', kind: 'boolean', read: (row) => row.vip },
    { key: 'stage', label: 'Stage', kind: 'enum', read: (row) => row.stage },
  ],
  search: (row) => [row.name, row.stage],
};

const context = { now: new Date('2026-10-03T12:00:00.000Z'), userId: 'u1' };

const base: Row = {
  owner: null,
  priority: 2,
  name: 'Ada Lovelace',
  due: null,
  tags: [],
  vip: null,
  stage: 'ready',
};

function all(...children: FilterNode[]): FilterGroup {
  return { kind: 'group', combinator: 'and', children };
}

function matches(row: Partial<Row>, group: FilterGroup): boolean {
  return evaluateFilter(group, { ...base, ...row }, registry, context);
}

describe('evaluateFilter', () => {
  test('me resolves to the viewer and none matches null', () => {
    const mine = all({
      kind: 'condition',
      property: 'owner',
      operator: 'in',
      values: ['me'],
      negate: false,
    });
    const unowned = all({
      kind: 'condition',
      property: 'owner',
      operator: 'in',
      values: ['none'],
      negate: false,
    });
    expect(matches({ owner: 'u1' }, mine)).toBe(true);
    expect(matches({ owner: 'u2' }, mine)).toBe(false);
    expect(matches({ owner: null }, unowned)).toBe(true);
  });

  test('a negated condition matches a null value', () => {
    const notU2 = all({
      kind: 'condition',
      property: 'owner',
      operator: 'in',
      values: ['u2'],
      negate: true,
    });
    expect(matches({ owner: null }, notU2)).toBe(true);
    const notAda = all({
      kind: 'condition',
      property: 'name',
      operator: 'contains',
      value: 'ada',
      negate: true,
    });
    expect(matches({ name: null }, notAda)).toBe(true);
    expect(matches({ name: 'ADA' }, notAda)).toBe(false);
  });

  test('numbers match by set and by inclusive range', () => {
    expect(
      matches(
        { priority: 2 },
        all({
          kind: 'condition',
          property: 'priority',
          operator: 'in',
          values: ['1', '2'],
          negate: false,
        }),
      ),
    ).toBe(true);
    const range = all({
      kind: 'condition',
      property: 'priority',
      operator: 'range',
      from: '2',
      to: '3',
      negate: false,
    });
    expect(matches({ priority: 3 }, range)).toBe(true);
    expect(matches({ priority: 4 }, range)).toBe(false);
  });

  test('named dates use the UTC day of now', () => {
    const overdue = all({
      kind: 'condition',
      property: 'due',
      operator: 'in',
      values: ['overdue'],
      negate: false,
    });
    const today = all({
      kind: 'condition',
      property: 'due',
      operator: 'in',
      values: ['today'],
      negate: false,
    });
    expect(matches({ due: '2026-10-02T23:59:59.000Z' }, overdue)).toBe(true);
    expect(matches({ due: '2026-10-03T00:00:00.000Z' }, overdue)).toBe(false);
    expect(matches({ due: '2026-10-03T00:00:00.000Z' }, today)).toBe(true);
    expect(matches({ due: null }, overdue)).toBe(false);
  });

  test('a relative range of the past seven days is inclusive at both ends', () => {
    const recent = all({
      kind: 'condition',
      property: 'due',
      operator: 'relative',
      relative: { unit: 'day', offset: 7, direction: 'past' },
      negate: false,
    });
    expect(matches({ due: '2026-09-26T08:00:00.000Z' }, recent)).toBe(true);
    expect(matches({ due: '2026-09-25T23:00:00.000Z' }, recent)).toBe(false);
  });

  test('multi values match any of the wanted values and none matches empty', () => {
    const tagged = all({
      kind: 'condition',
      property: 'tags',
      operator: 'in',
      values: ['a', 'b'],
      negate: false,
    });
    expect(matches({ tags: ['b', 'c'] }, tagged)).toBe(true);
    expect(
      matches(
        { tags: [] },
        all({
          kind: 'condition',
          property: 'tags',
          operator: 'in',
          values: ['none'],
          negate: false,
        }),
      ),
    ).toBe(true);
  });

  test('a null boolean matches neither true nor false', () => {
    const notVip = all({
      kind: 'condition',
      property: 'vip',
      operator: 'in',
      values: ['false'],
      negate: false,
    });
    expect(matches({ vip: null }, notVip)).toBe(false);
    expect(matches({ vip: false }, notVip)).toBe(true);
  });

  test('or groups, empty groups and unknown properties', () => {
    const either: FilterGroup = {
      kind: 'group',
      combinator: 'or',
      children: [
        { kind: 'condition', property: 'stage', operator: 'in', values: ['new'], negate: false },
        { kind: 'condition', property: 'priority', operator: 'in', values: ['2'], negate: false },
      ],
    };
    expect(matches({}, either)).toBe(true);
    expect(matches({}, all())).toBe(true);
    expect(
      matches(
        {},
        all({
          kind: 'condition',
          property: 'ghost',
          operator: 'in',
          values: ['x'],
          negate: true,
        }),
      ),
    ).toBe(true);
  });
});

describe('negation over missing values', () => {
  function not(property: string, rest: Record<string, unknown>): FilterGroup {
    return all({
      kind: 'condition',
      property,
      negate: true,
      ...rest,
    } as FilterNode);
  }

  test('a negated null boolean matches', () => {
    const notTrue = not('vip', { operator: 'in', values: ['true'] });
    const notFalse = not('vip', { operator: 'in', values: ['false'] });
    expect(matches({ vip: null }, notTrue)).toBe(true);
    expect(matches({ vip: null }, notFalse)).toBe(true);
    expect(matches({ vip: true }, notTrue)).toBe(false);
    expect(matches({ vip: false }, notFalse)).toBe(false);
  });

  test('a negated multi matches null and empty lists and excludes a hit', () => {
    const notA = not('tags', { operator: 'in', values: ['a'] });
    expect(matches({ tags: [] }, notA)).toBe(true);
    expect(matches({ tags: ['b'] }, notA)).toBe(true);
    expect(matches({ tags: ['a', 'b'] }, notA)).toBe(false);
    const notNone = not('tags', { operator: 'in', values: ['none'] });
    expect(matches({ tags: [] }, notNone)).toBe(false);
    expect(matches({ tags: ['a'] }, notNone)).toBe(true);
  });

  test('a negated date condition matches a null date', () => {
    expect(matches({ due: null }, not('due', { operator: 'in', values: ['overdue'] }))).toBe(true);
    expect(matches({ due: null }, not('due', { operator: 'in', values: ['today'] }))).toBe(true);
    expect(
      matches({ due: null }, not('due', { operator: 'range', from: '2026-10-01', to: null })),
    ).toBe(true);
    expect(
      matches(
        { due: null },
        not('due', {
          operator: 'relative',
          relative: { unit: 'day', offset: 7, direction: 'past' },
        }),
      ),
    ).toBe(true);
    expect(
      matches(
        { due: '2026-10-02T08:00:00.000Z' },
        not('due', { operator: 'in', values: ['overdue'] }),
      ),
    ).toBe(false);
  });

  test('a null date matches none and is excluded by any', () => {
    expect(
      matches(
        { due: null },
        all({
          kind: 'condition',
          property: 'due',
          operator: 'in',
          values: ['none'],
          negate: false,
        }),
      ),
    ).toBe(true);
    expect(
      matches(
        { due: null },
        all({ kind: 'condition', property: 'due', operator: 'in', values: ['any'], negate: false }),
      ),
    ).toBe(false);
  });

  test('a null date never matches a positive range or relative condition', () => {
    const range = all({
      kind: 'condition',
      property: 'due',
      operator: 'range',
      from: '2026-10-01',
      to: null,
      negate: false,
    });
    expect(matches({ due: null }, range)).toBe(false);
  });

  test('a negated number range matches outside the range', () => {
    const outside = not('priority', { operator: 'range', from: '2', to: '3' });
    expect(matches({ priority: 4 }, outside)).toBe(true);
    expect(matches({ priority: 2 }, outside)).toBe(false);
  });

  test('a null number does not match a range and a negated one does', () => {
    const nullable: FilterRegistry<{ readonly size: number | null }> = {
      object: 'company',
      properties: [{ key: 'size', label: 'Size', kind: 'number', read: (row) => row.size }],
      search: () => [],
    };
    const range = all({
      kind: 'condition',
      property: 'size',
      operator: 'range',
      from: '1',
      to: '5',
      negate: false,
    });
    const notRange = all({
      kind: 'condition',
      property: 'size',
      operator: 'range',
      from: '1',
      to: '5',
      negate: true,
    });
    expect(evaluateFilter(range, { size: null }, nullable, context)).toBe(false);
    expect(evaluateFilter(notRange, { size: null }, nullable, context)).toBe(true);
  });
});

describe('groups with nothing to decide', () => {
  const stage = (value: string): FilterNode => ({
    kind: 'condition',
    property: 'stage',
    operator: 'in',
    values: [value],
    negate: false,
  });
  const ghost: FilterNode = {
    kind: 'condition',
    property: 'ghost',
    operator: 'in',
    values: ['x'],
    negate: false,
  };

  test('an or group with an empty subgroup is decided by its other children', () => {
    const empty: FilterGroup = { kind: 'group', combinator: 'and', children: [] };
    const either: FilterGroup = {
      kind: 'group',
      combinator: 'or',
      children: [empty, stage('new')],
    };
    expect(matches({ stage: 'ready' }, either)).toBe(false);
    expect(matches({ stage: 'new' }, either)).toBe(true);
  });

  test('an or group holding only an empty subgroup matches', () => {
    const empty: FilterGroup = { kind: 'group', combinator: 'and', children: [] };
    expect(matches({}, { kind: 'group', combinator: 'or', children: [empty] })).toBe(true);
  });

  test('a nested group of unknown properties is ignored by its parent', () => {
    const unknown: FilterGroup = { kind: 'group', combinator: 'and', children: [ghost, ghost] };
    const parent = all(unknown, stage('new'));
    expect(matches({ stage: 'ready' }, parent)).toBe(false);
    expect(matches({ stage: 'new' }, parent)).toBe(true);
    expect(matches({ stage: 'ready' }, all(unknown))).toBe(true);
  });
});

describe('matchesSearch', () => {
  test('every token must appear in some search field', () => {
    expect(matchesSearch(base, 'ada ready', registry)).toBe(true);
    expect(matchesSearch(base, 'ada grace', registry)).toBe(false);
    expect(matchesSearch(base, '   ', registry)).toBe(true);
  });
});
