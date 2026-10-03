import { describe, expect, test } from 'bun:test';
import type { ActivityRow } from '@gravity/shared/records';
import { describeActivity } from '@/features/timeline/describe-activity.ts';

function activity(
  kind: string,
  payload: Record<string, unknown>,
  actor: ActivityRow['actor'] = { type: 'user', id: 'u1' },
): ActivityRow {
  return {
    id: 'a1',
    kind,
    actor,
    occurredAt: '2026-10-03T09:00:00.000Z',
    payload,
    links: [],
    syncId: 1,
  };
}

const people = new Map([
  ['u1', 'Ada'],
  ['u2', 'Tess'],
]);
const names = { memberName: (id: string) => people.get(id) };

describe('describeActivity', () => {
  test('names the actor and what changed', () => {
    expect(describeActivity(activity('lead.created', { key: 'YOD-1' }), names)).toBe(
      'Ada created YOD-1',
    );
    expect(
      describeActivity(
        activity('lead.stage_changed', {
          key: 'YOD-1',
          changes: { stageId: { from: { name: 'New' }, to: { name: 'Ready' } } },
        }),
        names,
      ),
    ).toBe('Ada moved YOD-1 from New to Ready');
    expect(
      describeActivity(
        activity('lead.held', { key: 'YOD-1', changes: { holdReason: { to: 'Back in Q1' } } }),
        names,
      ),
    ).toBe('Ada put YOD-1 on hold: Back in Q1');
  });

  test('names the new owner, or nobody', () => {
    expect(
      describeActivity(
        activity('lead.owner_changed', { key: 'YOD-1', changes: { ownerId: { to: 'u2' } } }),
        names,
      ),
    ).toBe('Ada assigned YOD-1 to Tess');
    expect(
      describeActivity(
        activity('lead.owner_changed', { key: 'YOD-1', changes: { ownerId: { to: null } } }),
        names,
      ),
    ).toBe('Ada assigned YOD-1 to nobody');
  });

  test('renders agents as acting for their human', () => {
    const agent = { type: 'agent' as const, id: 'claude', name: 'Claude for Ada' };
    expect(describeActivity(activity('lead.closed', { key: 'YOD-1' }, agent), names)).toBe(
      'Claude for Ada closed YOD-1',
    );
  });

  test('a payload of the wrong shape renders a generic line instead of throwing', () => {
    expect(
      describeActivity(activity('lead.stage_changed', { key: 42, changes: 'nope' }), names),
    ).toBe('Ada updated this record');
    expect(describeActivity(activity('lead.created', { key: ['YOD-1'] }), names)).toBe(
      'Ada updated this record',
    );
  });

  test('an unknown kind still says who did something to what', () => {
    expect(describeActivity(activity('lead.reticulated', { key: 'YOD-9' }), names)).toBe(
      'Ada updated YOD-9',
    );
  });
});
