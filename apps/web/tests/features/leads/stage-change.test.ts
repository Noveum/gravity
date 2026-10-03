import { describe, expect, test } from 'bun:test';
import { stageChangeFor } from '@/features/leads/stage-change.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

const stages = bootstrapFixture().stages;
function stage(name: string) {
  const found = stages.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(name);
  return found;
}

describe('stageChangeFor', () => {
  test('an open stage patches the stage', () => {
    expect(stageChangeFor(leadFixture(), stage('Contacted'))).toEqual({
      kind: 'change',
      change: { type: 'update', patch: { stageId: 'stage-contacted' } },
    });
  });

  test('a won or lost stage closes the lead', () => {
    expect(stageChangeFor(leadFixture(), stage('Qualified'))).toEqual({
      kind: 'change',
      change: { type: 'close', stageId: 'stage-qualified' },
    });
    expect(stageChangeFor(leadFixture(), stage('Do not contact'))).toEqual({
      kind: 'change',
      change: { type: 'close', stageId: 'stage-do-not-contact' },
    });
  });

  test('a hold stage needs a reason first', () => {
    expect(stageChangeFor(leadFixture(), stage('On hold'))).toEqual({ kind: 'hold' });
  });

  test('the stage the lead is already in changes nothing', () => {
    expect(stageChangeFor(leadFixture({ stageId: 'ready' }), stage('Ready'))).toEqual({
      kind: 'none',
    });
  });
});
