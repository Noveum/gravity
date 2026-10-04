import { describe, expect, test } from 'bun:test';
import {
  emptyFilterGroup,
  type FilterGroup,
  inCondition,
  replaceCondition,
} from '../../src/filters/ast.ts';
import { leadFilterRegistry } from '../../src/filters/registries.ts';
import { safeFilter } from '../../src/filters/registry.ts';
import type { FieldDefinitionRow } from '../../src/records/rows.ts';

const registry = leadFilterRegistry();
const ready = replaceCondition(emptyFilterGroup(), inCondition('stage', ['ready']));

const region: FieldDefinitionRow = {
  id: 'f1',
  object: 'lead',
  pipelineId: 'p2',
  key: 'region',
  label: 'Region',
  type: 'select',
  options: [{ value: 'north', label: 'North' }],
  description: '',
  example: '',
  position: 0,
  syncId: 1,
  archivedAt: null,
};

describe('safeFilter', () => {
  test('a filter is pruned to what the registry and the schema accept', () => {
    const broken: FilterGroup = {
      kind: 'group',
      combinator: 'or',
      children: [
        inCondition('stage', []),
        inCondition('nonsense', ['x']),
        {
          kind: 'group',
          combinator: 'and',
          children: [inCondition('stage', []), inCondition('owner', ['me'])],
        },
      ],
    };
    expect(safeFilter(broken, registry)).toEqual({
      kind: 'group',
      combinator: 'or',
      children: [{ kind: 'group', combinator: 'and', children: [inCondition('owner', ['me'])] }],
    });
    expect(safeFilter(ready, registry)).toEqual(ready);
  });

  test('a field of another pipeline or an archived field is dropped, the rest kept', () => {
    const view: FilterGroup = {
      kind: 'group',
      combinator: 'and',
      children: [inCondition('stage', ['ready']), inCondition('fields.region', ['north'])],
    };
    expect(safeFilter(view, leadFilterRegistry([region], 'p1'))).toEqual(ready);
    expect(safeFilter(view, leadFilterRegistry([region], 'p2'))).toEqual(view);
    const archived = { ...region, archivedAt: '2026-10-04T00:00:00.000Z' };
    expect(safeFilter(view, leadFilterRegistry([archived], 'p2'))).toEqual(ready);
  });
});
