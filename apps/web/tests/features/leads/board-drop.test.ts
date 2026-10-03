import { describe, expect, test } from 'bun:test';
import { adjacentColumn, moveToStage } from '@/features/leads/board-drop.ts';
import { OTHER_STAGE_ID } from '@/features/leads/lead-groups.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

const stages = bootstrapFixture().stages;
function stage(name: string) {
  const found = stages.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(name);
  return found;
}

describe('moveToStage', () => {
  test('an open stage is a stage update, the same stage is nothing', () => {
    expect(moveToStage(leadFixture(), stage('Ready'))).toEqual({
      kind: 'change',
      change: { type: 'update', patch: { stageId: 'ready' } },
    });
    expect(moveToStage(leadFixture(), stage('New'))).toEqual({ kind: 'none' });
  });

  test('a hold stage asks for a reason and a closing stage closes', () => {
    expect(moveToStage(leadFixture(), stage('On hold'))).toEqual({ kind: 'hold' });
    expect(moveToStage(leadFixture(), stage('Closed: no reply'))).toEqual({
      kind: 'change',
      change: { type: 'close', stageId: stage('Closed: no reply').id },
    });
  });

  test('a drop outside every column or on the Other group is nothing', () => {
    expect(moveToStage(leadFixture(), undefined)).toEqual({ kind: 'none' });
    expect(moveToStage(leadFixture(), { ...stage('Ready'), id: OTHER_STAGE_ID })).toEqual({
      kind: 'none',
    });
  });
});

describe('adjacentColumn', () => {
  const column = (left: number) => ({
    left,
    top: 0,
    width: 288,
    height: 600,
    right: left + 288,
    bottom: 600,
  });
  const columns = [column(600), column(12), column(312)];

  test('finds the next column to the right and to the left of the dragged card', () => {
    const card = { ...column(20), width: 272, right: 292 };
    expect(adjacentColumn(columns, card, 1)?.left).toBe(312);
    expect(adjacentColumn(columns, card, -1)).toBeUndefined();
    const moved = { ...card, left: 320, right: 592 };
    expect(adjacentColumn(columns, moved, 1)?.left).toBe(600);
    expect(adjacentColumn(columns, moved, -1)?.left).toBe(12);
  });
});
