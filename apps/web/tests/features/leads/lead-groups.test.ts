import { describe, expect, test } from 'bun:test';
import {
  adjacentStage,
  buildLeadRows,
  groupLeadsByStage,
  OTHER_STAGE_ID,
  personHref,
  selectionTargets,
  selectionThrough,
  sortLeads,
  survivingNeighbour,
} from '@/features/leads/lead-groups.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

const stages = bootstrapFixture().stages;

describe('lead grouping', () => {
  test('urgent first, no priority last, newest first within a priority', () => {
    const sorted = sortLeads([
      leadFixture({ id: 'a', priority: 0, number: 9 }),
      leadFixture({ id: 'b', priority: 1, number: 2 }),
      leadFixture({ id: 'c', priority: 3, number: 5 }),
      leadFixture({ id: 'd', priority: 3, number: 7 }),
    ]);
    expect(sorted.map((lead) => lead.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  test('groups in stage order and hides empty stages unless asked', () => {
    const leads = [
      leadFixture({ id: 'a', stageId: 'ready' }),
      leadFixture({ id: 'b', stageId: 'new' }),
    ];
    expect(groupLeadsByStage(leads, stages).map((group) => group.stage.name)).toEqual([
      'New',
      'Ready',
    ]);
    expect(groupLeadsByStage(leads, stages, { showEmpty: true })).toHaveLength(13);
    expect(buildLeadRows(groupLeadsByStage(leads, stages)).map((row) => row.kind)).toEqual([
      'header',
      'lead',
      'header',
      'lead',
    ]);
  });

  test('leads in a stage the bootstrap does not know land in a trailing Other group', () => {
    const leads = [
      leadFixture({ id: 'a', stageId: 'gone' }),
      leadFixture({ id: 'b' }),
      leadFixture({ id: 'c', stageId: 'ready' }),
    ];
    const archived = stages.map((stage) =>
      stage.id === 'ready' ? { ...stage, archivedAt: '2026-10-02T10:00:00.000Z' } : stage,
    );
    const groups = groupLeadsByStage(leads, archived);
    expect(groups.map((group) => group.stage.name)).toEqual(['New', 'Other']);
    expect(groups.at(-1)?.stage.id).toBe(OTHER_STAGE_ID);
    expect(groups.at(-1)?.leads.map((lead) => lead.id)).toEqual(['a', 'c']);
    expect(groupLeadsByStage([leadFixture()], stages, { showEmpty: true })).toHaveLength(13);
  });

  test('a lost lead hands over to the next survivor, or the previous one at the end', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(survivingNeighbour(order, new Set(['a', 'c', 'd']), 'b')).toBe('c');
    expect(survivingNeighbour(order, new Set(['a', 'd']), 'b')).toBe('d');
    expect(survivingNeighbour(order, new Set(['a', 'b']), 'd')).toBe('b');
    expect(survivingNeighbour(order, new Set(['a']), 'z')).toBeUndefined();
    expect(survivingNeighbour(order, new Set(), 'b')).toBeUndefined();
  });

  test('selectionThrough extends and shrinks like Orbit', () => {
    expect(selectionThrough([], 'a', 'b')).toEqual(['a', 'b']);
    expect(selectionThrough(['a', 'b'], 'b', 'a')).toEqual(['a']);
  });

  test('adjacentStage walks live stages in order and stops at the ends', () => {
    expect(adjacentStage(stages, 'new', 1)?.id).toBe('stage-researching');
    expect(adjacentStage(stages, 'new', -1)).toBeUndefined();
  });

  test('the selection wins over the focused lead, in display order', () => {
    const ordered = [leadFixture({ id: 'a' }), leadFixture({ id: 'b' }), leadFixture({ id: 'c' })];
    const [first, , third] = ordered;
    expect(selectionTargets(ordered, ['c', 'a'], first).map((lead) => lead.id)).toEqual(['a', 'c']);
    expect(selectionTargets(ordered, [], third).map((lead) => lead.id)).toEqual(['c']);
    expect(selectionTargets(ordered, [], undefined)).toEqual([]);
    expect(selectionTargets(ordered, new Set(['b']), first).map((lead) => lead.id)).toEqual(['b']);
  });

  test('a lead opens on its person record', () => {
    expect(personHref({ id: 'l2', personId: 'per2' })).toBe('/people/per2?lead=l2');
  });
});
