import { describe, expect, test } from 'bun:test';
import { DomainError } from '../../src/errors/index.ts';
import {
  inverseLeadChange,
  type LeadState,
  resolveLeadChange,
  type StageLike,
} from '../../src/records/lead-change.ts';

const stages: StageLike[] = [
  { id: 'new', pipelineId: 'p1', category: 'open', sortOrder: 0, archivedAt: null },
  { id: 'ready', pipelineId: 'p1', category: 'open', sortOrder: 1, archivedAt: null },
  { id: 'won', pipelineId: 'p1', category: 'won', sortOrder: 2, archivedAt: null },
  { id: 'hold', pipelineId: 'p1', category: 'hold', sortOrder: 3, archivedAt: null },
  { id: 'lost', pipelineId: 'p1', category: 'lost', sortOrder: 4, archivedAt: null },
  { id: 'other', pipelineId: 'p2', category: 'open', sortOrder: 0, archivedAt: null },
];

const lead: LeadState = {
  pipelineId: 'p1',
  stageId: 'new',
  stageCategory: 'open',
  ownerId: 'u1',
  priority: 0,
  nextAction: 'Send intro',
  nextActionAt: '2026-10-05T09:00:00.000Z',
  holdReason: null,
  holdUntil: null,
  owedBy: 'none',
  fields: { industry: 'saas' },
};

describe('resolveLeadChange', () => {
  test('hold moves to the first hold stage with the reason', () => {
    const held = resolveLeadChange(
      lead,
      { type: 'hold', reason: 'Back in Q1', until: null },
      stages,
    );
    expect(held).toMatchObject({
      stageId: 'hold',
      stageCategory: 'hold',
      holdReason: 'Back in Q1',
    });
  });

  test('leaving hold clears the reason', () => {
    const held = resolveLeadChange(lead, { type: 'hold', reason: 'Later', until: null }, stages);
    const moved = resolveLeadChange(held, { type: 'update', patch: { stageId: 'ready' } }, stages);
    expect(moved).toMatchObject({ stageId: 'ready', holdReason: null, holdUntil: null });
  });

  test('a hold stage without a reason is refused', () => {
    expect(() =>
      resolveLeadChange(lead, { type: 'update', patch: { stageId: 'hold' } }, stages),
    ).toThrow(DomainError);
  });

  test('close defaults to the first lost stage and clears the next action', () => {
    const closed = resolveLeadChange(lead, { type: 'close' }, stages);
    expect(closed).toMatchObject({
      stageId: 'lost',
      stageCategory: 'lost',
      nextAction: null,
      nextActionAt: null,
    });
  });

  test('close refuses an open stage and update refuses another pipeline', () => {
    expect(() => resolveLeadChange(lead, { type: 'close', stageId: 'ready' }, stages)).toThrow(
      'Close a lead into a won or lost stage.',
    );
    expect(() =>
      resolveLeadChange(lead, { type: 'update', patch: { stageId: 'other' } }, stages),
    ).toThrow('That stage is not in this pipeline.');
  });

  test('field patches merge and null removes a key', () => {
    const next = resolveLeadChange(
      lead,
      { type: 'update', patch: { fields: { industry: null, seats: 4 } } },
      stages,
    );
    expect(next.fields).toEqual({ seats: 4 });
  });
});

describe('inverseLeadChange', () => {
  test('restores exactly the properties that changed', () => {
    const after = resolveLeadChange(
      lead,
      { type: 'update', patch: { stageId: 'ready', priority: 2 } },
      stages,
    );
    expect(inverseLeadChange(lead, after)).toEqual({
      type: 'update',
      patch: { stageId: 'new', priority: 0 },
    });
    expect(inverseLeadChange(lead, lead)).toBeNull();
  });

  test('undoing a hold restores the stage and clears the reason', () => {
    const held = resolveLeadChange(lead, { type: 'hold', reason: 'Later', until: null }, stages);
    const inverse = inverseLeadChange(lead, held);
    expect(inverse).toEqual({
      type: 'update',
      patch: { stageId: 'new', holdReason: null },
    });
    if (inverse === null) throw new Error('expected an inverse');
    expect(resolveLeadChange(held, inverse, stages)).toEqual(lead);
  });
});
