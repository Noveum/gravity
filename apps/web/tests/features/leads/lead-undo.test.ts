import { describe, expect, test } from 'bun:test';
import { describeChange, inverseChanges } from '@/features/leads/lead-undo.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

const stageNames = new Map([
  ['ready', 'Ready'],
  ['new', 'New'],
]);
const memberNames = new Map([
  ['u2', 'Tess'],
  ['u1', 'Ada'],
]);
const names = {
  stageName: (id: string) => stageNames.get(id),
  memberName: (id: string) => memberNames.get(id),
};

describe('inverseChanges', () => {
  test('groups leads that need the same restoring change', () => {
    const before = [
      leadFixture({ id: 'a', stageId: 'new' }),
      leadFixture({ id: 'b', stageId: 'new' }),
      leadFixture({ id: 'c', stageId: 'stage-contacted' }),
    ];
    const after = before.map((lead) => ({ ...lead, stageId: 'ready', syncId: lead.syncId + 1 }));
    const groups = inverseChanges(before, after);
    expect(groups.map((group) => [group.leads.map((lead) => lead.id), group.change])).toEqual([
      [['a', 'b'], { type: 'update', patch: { stageId: 'new' } }],
      [['c'], { type: 'update', patch: { stageId: 'stage-contacted' } }],
    ]);
  });

  test('leaves alone a field a teammate changed after us, and restores the rest', () => {
    const before = [leadFixture({ id: 'a', stageId: 'new', priority: 0 })];
    const after = [{ ...leadFixture({ id: 'a', stageId: 'ready', priority: 1 }), syncId: 11 }];
    const teammate = [
      {
        ...leadFixture({ id: 'a', stageId: 'stage-contacted', priority: 1, ownerId: 'u2' }),
        syncId: 12,
      },
    ];
    const groups = inverseChanges(before, after, teammate);
    expect(groups.map((group) => [group.leads.map((lead) => lead.syncId), group.change])).toEqual([
      [[12], { type: 'update', patch: { priority: 0 } }],
    ]);
  });

  test('skips a lead whose every changed field a teammate has since overwritten', () => {
    const before = [leadFixture({ id: 'a', stageId: 'new' })];
    const after = [leadFixture({ id: 'a', stageId: 'ready' })];
    const teammate = [leadFixture({ id: 'a', stageId: 'stage-contacted' })];
    expect(inverseChanges(before, after, teammate)).toEqual([]);
  });

  test('keeps a custom field a teammate left untouched', () => {
    const before = [leadFixture({ id: 'a', fields: { tier: 'gold', size: 10 } })];
    const after = [leadFixture({ id: 'a', fields: { tier: 'silver', size: 20 } })];
    const teammate = [leadFixture({ id: 'a', fields: { tier: 'silver', size: 30 } })];
    expect(inverseChanges(before, after, teammate)[0]?.change).toEqual({
      type: 'update',
      patch: { fields: { tier: 'gold' } },
    });
  });
});

describe('describeChange', () => {
  test('says what happened to how many leads', () => {
    expect(describeChange({ type: 'update', patch: { stageId: 'ready' } }, names, 12)).toBe(
      'Moved 12 leads to Ready',
    );
    expect(describeChange({ type: 'update', patch: { ownerId: 'u2' } }, names, 3)).toBe(
      'Assigned 3 leads to Tess',
    );
    expect(describeChange({ type: 'update', patch: { ownerId: null } }, names, 1)).toBe(
      'Unassigned 1 lead',
    );
    expect(describeChange({ type: 'update', patch: { priority: 1 } }, names, 2)).toBe(
      'Set priority to Urgent on 2 leads',
    );
    expect(describeChange({ type: 'hold', reason: 'Later', until: null }, names, 2)).toBe(
      'Put 2 leads on hold',
    );
    expect(describeChange({ type: 'close' }, names, 4)).toBe('Closed 4 leads');
  });
});
