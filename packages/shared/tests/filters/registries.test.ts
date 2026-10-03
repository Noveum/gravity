import { describe, expect, test } from 'bun:test';
import { emptyFilterGroup, inCondition, replaceCondition } from '../../src/filters/ast.ts';
import { evaluateFilter } from '../../src/filters/evaluate.ts';
import { leadFilterRegistry } from '../../src/filters/registries.ts';
import { filterIssues, propertyOf, pruneFilter } from '../../src/filters/registry.ts';
import type { FieldDefinitionRow, LeadRow } from '../../src/records/rows.ts';

const industry: FieldDefinitionRow = {
  id: 'f1',
  object: 'lead',
  pipelineId: 'p1',
  key: 'industry',
  label: 'Industry',
  type: 'select',
  options: [{ value: 'saas', label: 'SaaS' }],
  description: '',
  example: '',
  position: 0,
  syncId: 1,
  archivedAt: null,
};

const lead: LeadRow = {
  id: 'l1',
  organizationId: 'o1',
  pipelineId: 'p1',
  brandId: 'b1',
  number: 7,
  key: 'YOD-7',
  personId: 'per1',
  personName: 'Ada Lovelace',
  personEmail: 'ada@acme.io',
  personLinkedinUrl: null,
  companyId: null,
  companyName: null,
  ownerId: 'u1',
  stageId: 's1',
  stageCategory: 'open',
  source: 'manual',
  priority: 0,
  holdReason: null,
  holdUntil: null,
  nextAction: null,
  nextActionAt: null,
  owedBy: 'none',
  lastInboundAt: null,
  lastOutboundAt: null,
  fields: { industry: 'saas' },
  syncId: 3,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  archivedAt: null,
};

describe('leadFilterRegistry', () => {
  test('includes custom fields for the pipeline only', () => {
    expect(propertyOf(leadFilterRegistry([industry], 'p1'), 'fields.industry')?.kind).toBe('enum');
    expect(propertyOf(leadFilterRegistry([industry], 'p2'), 'fields.industry')).toBeUndefined();
  });

  test('evaluates a custom select field on a lead row', () => {
    const registry = leadFilterRegistry([industry], 'p1');
    const filter = replaceCondition(emptyFilterGroup(), inCondition('fields.industry', ['saas']));
    expect(evaluateFilter(filter, lead, registry, { now: new Date(), userId: 'u1' })).toBe(true);
  });

  test('the key is searchable', () => {
    expect(leadFilterRegistry().search(lead)).toContain('YOD-7');
  });
});

describe('filterIssues and pruneFilter', () => {
  const registry = leadFilterRegistry([industry], 'p1');

  test('names unknown properties, bad operators and bad values', () => {
    const filter = {
      kind: 'group' as const,
      combinator: 'and' as const,
      children: [
        inCondition('ghost', ['x']),
        {
          kind: 'condition' as const,
          property: 'person',
          operator: 'in' as const,
          values: ['x'],
          negate: false,
        },
        inCondition('priority', ['me']),
        inCondition('nextActionAt', ['tomorrow']),
      ],
    };
    expect(filterIssues(filter, registry)).toEqual([
      'There is no lead filter called ghost.',
      'Person does not support in.',
      'Priority cannot be filtered by me.',
      'Next action date takes none, any, overdue or today.',
    ]);
    expect(pruneFilter(filter, registry).children).toHaveLength(0);
  });
});
